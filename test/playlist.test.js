import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_PREFERENCES, validatePreferences } from '../src/companion.js';
import { DEFAULT_PLAYLIST, PlaylistPlayer, playlistItems, defaultVoiceSelection, validatePlaylist } from '../src/playlist.js';

const items = [{ id: 'a', group: '语音' }, { id: 'b', group: '语音' }, { id: 'song', group: '唱歌', random: false }];

test('legacy settings select all non-song voices; explicit empty and song selections are preserved', () => {
  const { voicePlaylist, stickerPlaylist, ...legacy } = DEFAULT_PREFERENCES;
  assert.deepEqual(validatePreferences(legacy), DEFAULT_PREFERENCES);
  assert.deepEqual(playlistItems(items, DEFAULT_PLAYLIST, defaultVoiceSelection).map(item => item.id), ['a', 'b']);
  assert.deepEqual(playlistItems(items, DEFAULT_PLAYLIST).map(item => item.id), ['a', 'b', 'song']);
  assert.deepEqual(playlistItems(items, { ids: [] }), []);
  assert.deepEqual(playlistItems(items, { ids: ['missing', 'song'] }).map(item => item.id), ['song']);
  assert.equal(defaultVoiceSelection({ group: '唱歌', random: true }), false);
  assert.deepEqual(validatePlaylist({ mode: 'sequence', ids: ['b', 'b'] }).ids, ['b']);
  for (const playlist of [null, [], { mode: 'bad', ids: [] }, { mode: 'random', ids: 'all' }, { mode: 'random', ids: [null] }]) {
    assert.throws(() => validatePreferences({ ...DEFAULT_PREFERENCES, voicePlaylist: playlist }));
  }
});

test('sequence loops selected items in catalog order and resets when the list changes', () => {
  const player = new PlaylistPlayer();
  const playlist = { mode: 'sequence', ids: ['b', 'a'] };
  assert.deepEqual(Array.from({ length: 5 }, () => player.next(items, playlist).id), ['a', 'b', 'a', 'b', 'a']);
  assert.equal(player.next(items, { ...playlist, ids: ['song'] }).id, 'song');
  assert.equal(player.next(items, { ...playlist, ids: [] }), null);
  assert.equal(player.next(items, { ...playlist, ids: ['missing'] }), null);
  assert.equal(player.next(items, playlist).id, 'a');
});

test('random avoids immediate repeats; repeat holds the first selected item; media cursors are independent', () => {
  const voice = new PlaylistPlayer();
  const sticker = new PlaylistPlayer();
  const playlist = { mode: 'random', ids: ['a', 'b'] };
  let previous;
  for (let i = 0; i < 25; i++) {
    const next = voice.next(items, playlist).id;
    assert.notEqual(next, previous);
    previous = next;
  }
  assert.deepEqual(Array.from({ length: 3 }, () => voice.next(items, { mode: 'repeat', ids: ['b', 'a'] }).id), ['a', 'a', 'a']);
  assert.equal(sticker.next(items, { mode: 'sequence', ids: ['a', 'b'] }).id, 'a');
  assert.equal(voice.next(items, { mode: 'random', ids: ['b'] }).id, 'b');
});
