import test from 'node:test';
import assert from 'node:assert/strict';
import { MusicQueue, isSong } from '../src/music.js';
import { defaultVoiceSelection } from '../src/playlist.js';

const items = [
  { id: 'voice', group: '常用语音' },
  { id: 'a', group: '唱歌' },
  { id: 'b', group: ' SONGS ' },
  { id: 'c', group: '自定义', music: true },
];
const sequence = { mode: 'sequence', ids: null };

test('songs include explicit custom music and stay out of default click voices', () => {
  assert.deepEqual(items.filter(isSong).map(item => item.id), ['a', 'b', 'c']);
  assert.deepEqual(items.filter(defaultVoiceSelection).map(item => item.id), ['voice']);
});

test('continuous playback loops selected songs and previous uses real playback history', () => {
  const queue = new MusicQueue();
  assert.equal(queue.select(items, sequence).id, 'a');
  assert.equal(queue.select(items, sequence).id, 'b');
  assert.equal(queue.select(items, sequence, { previous: true }).id, 'a');
  assert.equal(queue.select(items, sequence, { id: 'c' }).id, 'c');
  assert.equal(queue.select(items, sequence, { ended: true }).id, 'a');
  assert.throws(() => queue.select(items, sequence, { id: 'voice' }));
  assert.equal(queue.select(items, { ...sequence, ids: [] }), null);
});

test('single repeat repeats on completion but manual next still changes song', () => {
  const queue = new MusicQueue();
  const repeat = { mode: 'repeat', ids: ['a', 'b'] };
  assert.equal(queue.select(items, repeat).id, 'a');
  assert.equal(queue.select(items, repeat, { ended: true }).id, 'a');
  assert.equal(queue.select(items, repeat).id, 'b');
  assert.equal(queue.select(items, { mode: 'random', ids: ['a', 'b'] }).id, 'a');
  assert.equal(queue.select(items, { ...repeat, ids: ['c'] }, { previous: true }).id, 'c');
});
