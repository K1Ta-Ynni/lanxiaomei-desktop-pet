export const DEFAULT_SETTINGS = Object.freeze({
  mode: 'basic',
  displayName: '',
  baseUrl: 'https://api.deepseek.com',
  model: 'deepseek-flash',
  encryptedApiKey: '',
});

export function chatCompletionsUrl(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error('请填写有效的 API 地址。');
  }
  const localHosts = new Set(['localhost', '127.0.0.1', '[::1]']);
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && localHosts.has(url.hostname))) {
    throw new Error('远程 API 必须使用 HTTPS；HTTP 仅允许本机地址。');
  }
  if (url.username || url.password || url.search || url.hash) {
    throw new Error('API 地址中不要嵌入密钥、查询参数或片段。');
  }
  const path = url.pathname.replace(/\/+$/u, '');
  url.pathname = /\/chat\/completions$/u.test(path) ? path : `${path}/chat/completions`;
  return url.toString();
}

export function isDeepSeekEndpoint(value) {
  try { return new URL(value).hostname === 'api.deepseek.com'; }
  catch { return false; }
}

export function migrateModelSettings(value) {
  const settings = { ...DEFAULT_SETTINGS, ...(value && typeof value === 'object' ? value : {}) };
  if (!isDeepSeekEndpoint(settings.baseUrl)) return settings;
  if (new URL(settings.baseUrl).pathname.replace(/\/+$/u, '') === '/v1') settings.baseUrl = DEFAULT_SETTINGS.baseUrl;
  if (!settings.model || settings.model === 'deepseek-chat') settings.model = DEFAULT_SETTINGS.model;
  return settings;
}

export function validateSettings(input) {
  if (!input || typeof input !== 'object') throw new Error('设置格式不正确。');
  const mode = ['basic', 'companion', 'assistant'].includes(input.mode) ? input.mode : 'basic';
  if (typeof input.apiKey === 'string' && input.apiKey.length > 8192) throw new Error('API 密钥过长。');
  const displayName = String(input.displayName ?? '').trim().slice(0, 32);
  const model = String(input.model ?? '').trim().slice(0, 160);
  const baseUrl = String(input.baseUrl ?? '').trim().slice(0, 500);
  if (baseUrl) chatCompletionsUrl(baseUrl);
  return { mode, displayName, model, baseUrl, apiKey: String(input.apiKey ?? '').trim() };
}
