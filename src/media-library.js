import { readFile, writeFile, rename, mkdir, unlink } from 'node:fs/promises';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import { isSong } from './music.js';

const kinds = ['voice', 'music', 'sticker'];
const empty = () => ({ version: 2, voice: { groups: [], items: {} }, music: { groups: [], items: {} }, sticker: { groups: [], items: {} } });
function name(value, limit) {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > limit || /[\u0000-\u001f\u007f]/u.test(value)) {
    throw new Error(`名称需要为 1～${limit} 个字符，且不含换行或控制字符。`);
  }
  return value.trim();
}

// Display metadata lives in userData, never in the Git checkout or media files.
// Stable IDs and the original audio group retain playlist/song/entrance behavior.
export class MediaLibrary {
  state = empty();
  saving = Promise.resolve();
  constructor(path) { this.path = path; }
  async load(getAudio = async () => []) {
    let saved;
    try { saved = JSON.parse(await readFile(this.path, 'utf8')); }
    catch (error) {
      if (error.code === 'ENOENT') return;
      throw new Error('本地素材编辑记录无法读取，请检查 media-library.json。');
    }
    if (![1, 2].includes(saved?.version)) throw new Error('本地素材编辑记录版本不支持。');
    const legacy = saved.version === 1;
    if (legacy) {
      const songIds = new Set((await getAudio()).filter(isSong).map(item => item.id));
      const previous = saved.voice;
      if (!previous || !Array.isArray(previous.groups) || !previous.items || typeof previous.items !== 'object') throw new Error('旧版素材编辑记录格式不正确。');
      const entries = Object.entries(previous.items);
      const used = new Set(entries.map(([, value]) => value?.category));
      for (const kind of ['voice', 'music']) {
        const items = Object.fromEntries(entries.filter(([id]) => songIds.has(id) === (kind === 'music')));
        const categories = new Set(Object.values(items).map(value => value?.category));
        saved[kind] = { items, groups: previous.groups.filter(group => categories.has(group) || !used.has(group)) };
      }
    }
    const next = empty();
    for (const kind of kinds) {
      const section = saved[kind];
      if (!section || !Array.isArray(section.groups) || section.groups.length > 200 ||
          !section.items || typeof section.items !== 'object' || Array.isArray(section.items) || Object.keys(section.items).length > 1000) {
        throw new Error('本地素材编辑记录格式不正确。');
      }
      next[kind].groups = [...new Set(section.groups.map(value => name(value, 40)))];
      next[kind].items = Object.fromEntries(Object.entries(section.items).map(([id, value]) =>
        [id, { label: name(value?.label, 60), category: name(value?.category, 40) }]));
    }
    if (legacy) {
      try { await writeFile(this.path + '.v1-backup.json', await readFile(this.path), { flag: 'wx' }); }
      catch (error) { if (error.code !== 'EEXIST') throw error; }
      await this.persist(next);
    }
    this.state = next;
  }
  decorate(kind, items) {
    const section = this.state[kind];
    return items.map(item => ({ ...item, category: item.group || '未分类',
      ...(Object.hasOwn(section.items, item.id) ? section.items[item.id] : {}) }));
  }
  groups(kind, items) {
    return [...new Set([...this.state[kind].groups, ...this.decorate(kind, items).map(item => item.category)])];
  }
  edit(command, getItems) {
    const operation = this.saving.catch(() => {}).then(async () => {
      if (!command || !kinds.includes(command.kind)) throw new Error('素材类型无效。');
      const { kind, action } = command;
      const raw = await getItems(kind);
      const items = this.decorate(kind, raw);
      const groups = this.groups(kind, raw);
      const next = structuredClone(this.state);
      const section = next[kind];
      if (action === 'editItem' || action === 'resetItem') {
        const item = items.find(item => item.id === command.id);
        if (!item) throw new Error('这项素材已不存在，请刷新后重试。');
        if (action === 'resetItem') delete section.items[item.id];
        else {
          const category = name(command.category, 40);
          if (!groups.includes(category)) throw new Error('请先创建分类，再移动素材。');
          Object.defineProperty(section.items, item.id, { value: { label: name(command.label, 60), category }, enumerable: true, configurable: true, writable: true });
        }
      } else if (['moveItems', 'resetItems', 'renameItems'].includes(action)) {
        if (!Array.isArray(command.ids) || !command.ids.length || command.ids.length > 200 || new Set(command.ids).size !== command.ids.length) throw new Error('请选择 1～200 项不同的素材。');
        const selected = command.ids.map(id => items.find(item => item.id === id));
        if (selected.some(item => !item)) throw new Error('部分素材已不存在，请刷新后重新选择。');
        const category = action === 'moveItems' ? name(command.category, 40) : null;
        if (category && !groups.includes(category)) throw new Error('请先创建分类，再移动素材。');
        const prefix = action === 'renameItems' ? name(command.prefix, 50) : null;
        for (const [index, item] of selected.entries()) {
          if (action === 'resetItems') delete section.items[item.id];
          else Object.defineProperty(section.items, item.id, {
            value: { label: prefix ? `${prefix} ${String(index + 1).padStart(2, '0')}` : item.label, category: category || item.category },
            enumerable: true, configurable: true, writable: true,
          });
        }
      } else if (action === 'createGroup') {
        const group = name(command.name, 40);
        if (groups.includes(group)) throw new Error('已有同名分类。');
        if (groups.length >= 200) throw new Error('分类最多 200 个。');
        section.groups.push(group);
      } else if (action === 'renameGroup' || action === 'deleteGroup') {
        const from = name(command.name, 40);
        if (!groups.includes(from)) throw new Error('分类已不存在，请刷新后重试。');
        const to = action === 'deleteGroup' ? '未分类' : name(command.newName, 40);
        if (from === to) throw new Error(action === 'deleteGroup' ? '“未分类”用于接收移出的素材，不能删除。' : '请填写不同的新名称。');
        if (action === 'renameGroup' && groups.includes(to)) throw new Error('已有同名分类，请换一个名称。');
        section.groups = section.groups.filter(group => group !== from);
        if (!section.groups.includes(to)) section.groups.push(to);
        // Include edits to currently missing files so they stay consistent when restored.
        for (const item of [...Object.entries(section.items).map(([id, value]) => ({ id, ...value })), ...items]) {
          if (item.category === from) Object.defineProperty(section.items, item.id, {
            value: { label: item.label, category: to }, enumerable: true, configurable: true, writable: true,
          });
        }
      } else throw new Error('素材编辑操作无效。');
      if (Object.keys(section.items).length > 1000) throw new Error('编辑记录过多，请先恢复部分素材的默认设置。');
      await this.persist(next);
      this.state = next;
      return { saved: true };
    });
    this.saving = operation;
    return operation;
  }
  async persist(next) {
    await mkdir(dirname(this.path), { recursive: true });
    const temporary = `${this.path}.${randomUUID()}.tmp`;
    try {
      await writeFile(temporary, JSON.stringify(next, null, 2) + '\n', 'utf8');
      await rename(temporary, this.path);
    } catch (error) { await unlink(temporary).catch(() => {}); throw error; }
  }
}
