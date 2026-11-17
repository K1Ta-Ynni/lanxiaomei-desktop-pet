import test from 'node:test';
import assert from 'node:assert/strict';
import { chatCompletionsUrl, validateSettings, isDeepSeekEndpoint, migrateModelSettings, DEFAULT_SETTINGS } from '../src/shared.js';

test('normalizes an OpenAI-compatible base URL', () => {
  assert.equal(chatCompletionsUrl('https://example.com/v1/'), 'https://example.com/v1/chat/completions');
  assert.equal(chatCompletionsUrl('https://example.com/v1/chat/completions'), 'https://example.com/v1/chat/completions');
});

test('defaults to current DeepSeek API settings and detects the official host', () => {
  assert.equal(DEFAULT_SETTINGS.baseUrl, 'https://api.deepseek.com');
  assert.equal(DEFAULT_SETTINGS.model, 'deepseek-flash');
  assert.equal(isDeepSeekEndpoint('https://api.deepseek.com/v1'), true);
  assert.equal(isDeepSeekEndpoint('https://api.example.com'), false);
  assert.deepEqual(migrateModelSettings({ mode: 'companion', baseUrl: 'https://api.deepseek.com/v1', model: 'deepseek-chat' }), {
    ...DEFAULT_SETTINGS, mode: 'companion', baseUrl: 'https://api.deepseek.com', model: 'deepseek-flash',
  });
  assert.equal(migrateModelSettings({ baseUrl: 'https://other.example/v1', model: '' }).model, '');
});

test('allows local HTTP gateways and rejects remote HTTP or credentials in URLs', () => {
  assert.equal(chatCompletionsUrl('http://127.0.0.1:8080/v1'), 'http://127.0.0.1:8080/v1/chat/completions');
  assert.throws(() => chatCompletionsUrl('http://api.example.com/v1'), /HTTPS/u);
  assert.throws(() => chatCompletionsUrl('https://user:secret@example.com/v1'), /不要嵌入密钥/u);
});

test('bounds settings fields before persistence', () => {
  const settings = validateSettings({ displayName: '  蓝小妹  ', baseUrl: 'https://example.com/v1', model: ' demo ', apiKey: ' secret ' });
  assert.deepEqual(settings, { mode: 'basic', displayName: '蓝小妹', baseUrl: 'https://example.com/v1', model: 'demo', apiKey: 'secret' });
});

test('validates mode downgrade selections', () => {
  assert.equal(validateSettings({ mode: 'companion' }).mode, 'companion');
  assert.equal(validateSettings({ mode: 'unknown' }).mode, 'basic');
});
