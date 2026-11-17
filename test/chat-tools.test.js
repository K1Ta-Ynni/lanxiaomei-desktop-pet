import test from 'node:test';
import assert from 'node:assert/strict';
import { hasExplicitMediaIntent, findMedia, matchSticker, CHAT_TOOLS } from '../src/chat-tools.js';

test('only clear direct requests can trigger local media', () => {
  assert.equal(hasExplicitMediaIntent('蓝小妹，播放雨爱。', 'play_song'), true);
  assert.equal(hasExplicitMediaIntent('我想听雨爱', 'play_song'), true);
  assert.equal(hasExplicitMediaIntent('我最近常听雨爱', 'play_song'), false);
  assert.equal(hasExplicitMediaIntent('如果播放雨爱会怎样？', 'play_song'), false);
  assert.equal(hasExplicitMediaIntent('给我发个表情包', 'send_sticker'), true);
  assert.equal(hasExplicitMediaIntent('随机发一个表情包', 'send_sticker'), true);
  assert.equal(hasExplicitMediaIntent('不要发那个表情包', 'send_sticker'), false);
  assert.equal(hasExplicitMediaIntent('暂停歌曲', 'control_music'), true);
  assert.equal(hasExplicitMediaIntent('关闭', 'control_music'), true);
  assert.equal(hasExplicitMediaIntent('把音乐关掉', 'control_music'), true);
  assert.equal(hasExplicitMediaIntent('把歌曲关闭', 'control_music'), true);
  assert.equal(hasExplicitMediaIntent('我记得你之前暂停了歌曲', 'control_music'), false);
  assert.equal(hasExplicitMediaIntent('Please play Rain Love', 'play_song'), true);
  assert.equal(hasExplicitMediaIntent("Don't play Rain Love", 'play_song'), false);
  assert.equal(hasExplicitMediaIntent('I like Rain Love', 'play_song'), false);
  assert.equal(hasExplicitMediaIntent('Send me a sticker', 'send_sticker'), true);
});

test('media matching excludes songs from voice and asks about ambiguous matches', () => {
  const catalog = [
    { id: 'song', label: '雨爱', music: true },
    { id: 'voice-a', label: '早安', text: '早安呀' },
    { id: 'voice-b', label: '早安' },
  ];
  assert.equal(findMedia('雨爱', catalog).item.id, 'song');
  assert.equal(findMedia('雨爱', catalog, { excludeSongs: true }).kind, 'missing');
  assert.equal(findMedia('早安', catalog).kind, 'ambiguous');
  assert.equal(findMedia('', catalog).kind, 'missing');
  assert.equal(matchSticker('随机', [{ id: 'a' }, { id: 'b' }]).kind, 'match');
  assert.equal(CHAT_TOOLS.length, 4);
});
