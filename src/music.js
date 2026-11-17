import { playlistItems } from './playlist.js';

export const MAX_VOICE_BYTES = 30 * 1024 * 1024;
export const MAX_SONG_BYTES = 500 * 1024 * 1024;

export function isSong(clip) {
  return clip.music === true || ['唱歌', '歌曲', '音乐', 'song', 'songs', 'music'].includes(clip.group?.trim().toLowerCase());
}

// Transport history is separate from the click-interaction playlist cursor.
export class MusicQueue {
  currentId = null;
  history = [];

  select(items, playlist, { id, previous = false, ended = false } = {}) {
    const choices = playlistItems(items.filter(isSong), playlist);
    if (!choices.length) return null;
    const index = choices.findIndex(item => item.id === this.currentId);
    let clip;
    if (id !== undefined) clip = choices.find(item => item.id === id);
    else if (previous) {
      while (this.history.length && !clip) {
        const old = this.history.pop();
        clip = choices.find(item => item.id === old);
      }
      clip ??= choices[(Math.max(0, index) - 1 + choices.length) % choices.length];
    } else if (ended && playlist.mode === 'repeat' && index >= 0) clip = choices[index];
    else if (playlist.mode === 'random') {
      const candidates = choices.length > 1 ? choices.filter(item => item.id !== this.currentId) : choices;
      clip = candidates[Math.floor(Math.random() * candidates.length)];
    } else clip = choices[(index + 1) % choices.length];
    if (!clip) throw new Error('这首歌不在歌曲播放列表中。');
    if (!previous && this.currentId && this.currentId !== clip.id) this.history.push(this.currentId);
    this.history = this.history.slice(-200);
    this.currentId = clip.id;
    return clip;
  }
}
