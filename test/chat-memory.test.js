import test from 'node:test';
import assert from 'node:assert/strict';
import { chatSystemPrompt, rememberExplicit, validateMemories } from '../src/chat-memory.js';

test('only explicit remember commands append bounded durable memories', () => {
  const original = [];
  const next = rememberExplicit('蓝小妹，记住我喜欢雨爱。', original);
  assert.equal(next.length, 1);
  assert.equal(next[0].text, '我喜欢雨爱。');
  assert.equal(rememberExplicit('我喜欢雨爱。', original), original);
  assert.equal(rememberExplicit('记住', original), original);
  assert.equal(validateMemories([{ id: 'a', text: '  资料  ' }, { id: 3, text: 'bad' }])[0].text, '资料');
  assert.match(chatSystemPrompt('蓝小妹', next), /以下JSON/u);
});
