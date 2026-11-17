export const CHAT_TOOLS = Object.freeze([
  { type: 'function', function: { name: 'play_song', description: '按用户明确要求播放本地歌曲。', parameters: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'], additionalProperties: false } } },
  { type: 'function', function: { name: 'play_voice', description: '按用户明确要求播放一段本地录制语音。', parameters: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'], additionalProperties: false } } },
  { type: 'function', function: { name: 'send_sticker', description: '按用户明确要求发一张本地表情包；可以按文件名挑选，或在用户允许随机时随机选择。', parameters: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'], additionalProperties: false } } },
  { type: 'function', function: { name: 'control_music', description: '按用户明确要求暂停、继续、停止或切换歌曲。', parameters: { type: 'object', properties: { action: { type: 'string', enum: ['pause', 'resume', 'next', 'previous', 'stop'] } }, required: ['action'], additionalProperties: false } } },
]);

// Short player commands do not need a model to decide whether to execute them.
export function musicControlAction(text) {
  if (!hasExplicitMediaIntent(text, 'control_music')) return null;
  if (/暂停|\bpause\b/iu.test(text)) return 'pause';
  if (/继续|\b(?:resume|continue)\b/iu.test(text)) return 'resume';
  if (/下一首|切歌|\b(?:next|skip)\b/iu.test(text)) return 'next';
  if (/上一首|\bprevious\b/iu.test(text)) return 'previous';
  if (/关闭|关掉|停|\bstop\b/iu.test(text)) return 'stop';
  return null;
}

export function hasExplicitMediaIntent(text, tool) {
  const value = String(text || '');
  if (/\b(?:don't|do not|never|for example|what if|i (?:like|enjoy|heard|listened))\b/iu.test(value)) return false;
  const english = tool === 'control_music'
    ? /^(?:blue[, ]+)?(?:please )?(?:pause|resume|continue|stop|next|previous|skip)(?: (?:the |this )?(?:music|song|track|one))?[.!?]*$/iu
    : tool === 'send_sticker'
      ? /^(?:blue[, ]+)?(?:please )?(?:send|show)(?: me)? .*(?:sticker|meme|gif)[.!?]*$/iu
      : /^(?:blue[, ]+)?(?:(?:please )?(?:play|put on)|(?:can|could) you (?:play|put on)) .+/iu;
  if (english.test(value.trim())) return true;
  if (/不要|别(?:再|给我)?(?:放|播|发)|不(?:要|用|想)(?:再|给我)?(?:放|播|发)|如果|假如|举个例子|比如|怎么实现|我喜欢|我听过|我在听/u.test(value)) return false;
  if (tool === 'control_music') return /^(?:蓝小妹[，, ]*)?(?:(?:请|帮我)?(?:关闭(?:播放|歌曲|音乐)?|关掉(?:播放|歌曲|音乐)?|暂停(?:一下|播放|歌曲|音乐)?|继续(?:播放|放歌)?|下一首(?:歌)?|上一首(?:歌)?|切歌|停(?:止|一下|掉)(?:播放|音乐|歌曲)?)|把(?:播放|歌曲|音乐)?(?:关闭|关掉|暂停|停止|停掉))\s*[。！!吗？?]*$/u.test(value.trim());
  if (tool === 'send_sticker') return /^(?:蓝小妹[，, ]*)?(?:请|帮我|给我)?(?:随机)?(?:发|丢)(?:个|张|一下|一个)?(?:.*(?:表情包?|图片?))\s*[。！!吧呀？?]*$/u.test(value.trim());
  return /^(?:蓝小妹[，, ]*)?(?:(?:请|帮我|给我)(?:播放|放|来)|(?:播放|放一下|放一首|来一首|来一段|来一句)|我想(?:听|让你(?:播放|放))|想听一下|能(?:不能|否)?(?:给我)?(?:播放|放)|可以(?:给我)?(?:播放|放))[^。！？!?]*[。！？!?吗嘛]*$/u.test(value.trim());
}

function normalized(value) { return String(value || '').toLocaleLowerCase().replace(/[\s\p{P}\p{S}]/gu, ''); }

export function findMedia(query, catalog, { excludeSongs = false } = {}) {
  const needle = normalized(query);
  if (!needle) return { kind: 'missing' };
  const rows = catalog.filter(row => !excludeSongs || !row.music);
  const byId = rows.filter(row => normalized(row.id) === needle);
  if (byId.length === 1) return { kind: 'match', item: byId[0] };
  const exact = rows.filter(row => normalized(row.label) === needle || normalized(row.text) === needle);
  if (exact.length === 1) return { kind: 'match', item: exact[0] };
  if (exact.length > 1) return { kind: 'ambiguous', items: exact.slice(0, 5) };
  const matches = rows.filter(row => [row.label, row.text, row.id].some(field => normalized(field) && (normalized(field).includes(needle) || needle.includes(normalized(field)))));
  if (matches.length === 1) return { kind: 'match', item: matches[0] };
  if (matches.length > 1) return { kind: 'ambiguous', items: matches.slice(0, 5) };
  return { kind: 'missing' };
}

export function matchSticker(query, catalog) {
  const needle = normalized(query);
  if (!catalog.length) return { kind: 'missing' };
  if (/随机|隨機|随便/u.test(needle)) {
    return { kind: 'match', item: catalog[Math.floor(Math.random() * catalog.length)] };
  }
  return findMedia(query, catalog);
}
