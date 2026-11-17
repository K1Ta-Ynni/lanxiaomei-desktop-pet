export const DEFAULT_PLAYLIST = Object.freeze({ mode: 'random', ids: null });

export function validatePlaylist(value = DEFAULT_PLAYLIST) {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      !['random', 'sequence', 'repeat'].includes(value.mode) ||
      (value.ids !== null && (!Array.isArray(value.ids) || value.ids.length > 200 ||
        value.ids.some(id => typeof id !== 'string' || !id.length || id.length > 255)))) {
    throw new Error('播放列表设置无效。');
  }
  return { mode: value.mode, ids: value.ids === null ? null : [...new Set(value.ids)] };
}

export function defaultVoiceSelection(clip) {
  return clip.random !== false && clip.music !== true && !['唱歌', '歌曲', '音乐', 'song', 'songs', 'music'].includes(clip.group?.trim().toLowerCase());
}

export function playlistItems(items, playlist = DEFAULT_PLAYLIST, defaultSelected = () => true) {
  if (playlist.ids === null) return items.filter(defaultSelected);
  const selected = new Set(playlist.ids);
  return items.filter(item => selected.has(item.id));
}

// Each media kind owns one cursor. Selection/mode changes restart its order.
export class PlaylistPlayer {
  #key;
  #lastId;
  next(items, playlist = DEFAULT_PLAYLIST, defaultSelected = () => true) {
    const choices = playlistItems(items, playlist, defaultSelected);
    const key = JSON.stringify([playlist.mode, choices.map(item => item.id)]);
    if (key !== this.#key) { this.#key = key; this.#lastId = undefined; }
    if (!choices.length) return null;
    const index = choices.findIndex(item => item.id === this.#lastId);
    let next;
    if (playlist.mode === 'sequence') next = choices[(index + 1) % choices.length];
    else if (playlist.mode === 'repeat') next = choices[Math.max(0, index)];
    else {
      const candidates = choices.length > 1 ? choices.filter(item => item.id !== this.#lastId) : choices;
      next = candidates[Math.floor(Math.random() * candidates.length)];
    }
    this.#lastId = next.id;
    return next;
  }
}
