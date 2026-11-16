import test from 'node:test';
import assert from 'node:assert/strict';
import { chatCompletionsUrl, validateSettings } from '../src/shared.js';

test('normalizes an OpenAI-compatible base URL', () => {
  assert.equal(chatCompletionsUrl('https://example.com/v1/'), 'https://example.com/v1/chat/completions');
  assert.equal(chatCompletionsUrl('https://example.com/v1/chat/completions'), 'https://example.com/v1/chat/completions');
});

test('allows local HTTP gateways and rejects remote HTTP or credentials in URLs', () => {
  assert.equal(chatCompletionsUrl('http://127.0.0.1:8080/v1'), 'http://127.0.0.1:8080/v1/chat/completions');
  assert.throws(() => chatCompletionsUrl('http://api.example.com/v1'), /HTTPS/u);
  assert.throws(() => chatCompletionsUrl('https://user:secret@example.com/v1'), /不要嵌入密钥/u);
});

test('bounds settings fields before persistence', () => {
  const settings = validateSettings({ displayName: '  蓝小妹  ', baseUrl: 'https://example.com/v1', model: ' demo ', apiKey: ' secret ' });
  assert.deepEqual(settings, { displayName: '蓝小妹', baseUrl: 'https://example.com/v1', model: 'demo', apiKey: 'secret' });
});
