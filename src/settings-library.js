export function libraryEditor({ kind, groups, refresh, show }) {
  const dialog = document.querySelector('#library-editor');
  const form = document.querySelector('#library-edit-form');
  const title = document.querySelector('#library-editor-title');
  const label = document.querySelector('#library-edit-name');
  const nameField = document.querySelector('#library-edit-name-field');
  const nameCaption = document.querySelector('#library-edit-name-label');
  const category = document.querySelector('#library-edit-category');
  const categoryField = document.querySelector('#library-edit-category-field');
  const note = document.querySelector('#library-edit-note');
  const error = document.querySelector('#library-edit-error');
  const submit = document.querySelector('#library-edit-save');
  const reset = document.querySelector('#library-edit-reset');
  function open(action, item) {
    form.reset();
    error.textContent = '';
    const batch = Array.isArray(item);
    title.textContent = { editItem: '编辑素材', createGroup: '新建分类', renameGroup: '重命名分类', deleteGroup: '删除分类',
      moveItems: '批量移动分类', renameItems: '批量编号改名', resetItems: '批量恢复默认' }[action] + (batch ? ` · ${item.length} 项` : '');
    label.value = typeof item === 'string' ? item : item?.label || '';
    label.maxLength = action === 'editItem' ? 60 : action === 'renameItems' ? 50 : 40;
    nameField.hidden = ['moveItems', 'resetItems'].includes(action);
    nameCaption.textContent = action === 'renameItems' ? '统一名称前缀（自动追加 01、02…）' : '名称';
    label.disabled = action === 'deleteGroup' || nameField.hidden;
    categoryField.hidden = !['editItem', 'moveItems'].includes(action);
    category.replaceChildren(...groups.map(group => {
      const option = document.createElement('option'); option.value = option.textContent = group; return option;
    }));
    category.value = item?.category || groups[0] || '未分类';
    note.textContent = action === 'deleteGroup' ? '该分类中的素材将移到“未分类”，文件和播放列表会保留。'
      : action === 'resetItems' ? '将选中素材的显示名称和分类恢复为默认设置，保留文件及播放列表。'
      : action === 'renameItems' ? '按素材库顺序编号，例如“收藏 01、收藏 02”。可单独编辑或恢复默认。'
      : '仅修改本机显示名称和分类，歌曲、入场语音等播放用途保持不变。';
    submit.textContent = action === 'deleteGroup' ? '删除分类' : '保存';
    reset.hidden = action !== 'editItem';
    let busy = false;
    async function save(command) {
      if (busy) return;
      busy = true; submit.disabled = reset.disabled = true;
      try {
        await window.petApp.editMedia({ kind, ...command });
        dialog.close();
        await refresh();
        show('本地编辑已保存。');
      } catch (failure) { error.textContent = failure.message; }
      finally { busy = false; submit.disabled = reset.disabled = false; }
    }
    form.onsubmit = event => {
      event.preventDefault();
      void save(batch ? { action, ids: item.map(row => row.id), category: category.value, prefix: label.value }
        : action === 'editItem' ? { action, id: item.id, label: label.value, category: category.value }
        : action === 'createGroup' ? { action, name: label.value } : { action, name: item, newName: label.value });
    };
    reset.onclick = () => { void save({ action: 'resetItem', id: item.id }); };
    dialog.showModal();
    if (!label.disabled) { label.focus(); label.select(); }
    else if (!categoryField.hidden) category.focus();
    else submit.focus();
  }
  return {
    itemButton(item) {
      const button = document.createElement('button');
      button.type = 'button'; button.className = 'media-edit-button'; button.dataset.mediaEdit = item.id;
      button.textContent = '编辑'; button.setAttribute('aria-label', '编辑' + item.label);
      button.addEventListener('click', () => open('editItem', item));
      return button;
    },
    categoryHeader(group, count) {
      const summary = document.createElement('summary');
      const text = document.createElement('span'); text.textContent = group + ' · ' + count;
      const tools = document.createElement('span'); tools.className = 'category-tools';
      for (const [action, caption] of [['renameGroup', '重命名'], ['deleteGroup', '删除分类']]) {
        if (group === '未分类' && action === 'deleteGroup') continue;
        const button = document.createElement('button'); button.type = 'button'; button.className = 'media-edit-button';
        button.textContent = caption; button.dataset.categoryAction = action; button.dataset.category = group;
        button.addEventListener('click', event => { event.preventDefault(); event.stopPropagation(); open(action, group); });
        tools.append(button);
      }
      summary.append(text, tools);
      return summary;
    },
    create: () => open('createGroup'),
    bulk: (action, items) => open(action, items),
  };
}

document.querySelector('#library-edit-cancel').addEventListener('click', () => document.querySelector('#library-editor').close());

export function batchEditor(kind) {
  const toolbar = document.querySelector(`#${kind}-batch-toolbar`);
  const list = document.querySelector(`#${kind}-list`);
  const panel = toolbar.closest('[data-panel]');
  const hint = list.parentElement.querySelector(':scope > summary > span');
  const originalHint = hint?.textContent;
  let active = false, selected = new Set(), items = [], editor;
  const toggle = toolbar.querySelector('[data-batch-toggle]');
  const controls = toolbar.querySelector('[data-batch-controls]');
  function render() {
    panel.classList.toggle('batch-mode', active);
    toggle.textContent = active ? '完成批量编辑' : '批量编辑';
    toggle.setAttribute('aria-pressed', String(active));
    controls.hidden = !active;
    if (hint) hint.textContent = active ? '当前勾选仅用于批量编辑' : originalHint;
    toolbar.querySelector('[data-batch-count]').textContent = `编辑已选 ${selected.size} / ${items.length} 项`;
    for (const action of toolbar.querySelectorAll('[data-batch-action]')) action.disabled = !selected.size;
    for (const input of list.querySelectorAll('[data-batch-select]')) {
      input.checked = selected.has(input.dataset.batchSelect);
      input.closest('.playlist-entry, .song-row').classList.toggle('batch-selected', active && input.checked);
    }
  }
  toggle.addEventListener('click', () => { active = !active; if (!active) selected.clear(); render(); });
  for (const action of ['all', 'clear', 'invert']) toolbar.querySelector(`[data-batch-${action}]`).addEventListener('click', () => {
    selected = new Set(action === 'all' ? items.map(item => item.id) : action === 'clear' ? [] : items.filter(item => !selected.has(item.id)).map(item => item.id));
    render();
  });
  for (const button of toolbar.querySelectorAll('[data-batch-action]')) button.addEventListener('click', () => {
    editor?.bulk(button.dataset.batchAction, items.filter(item => selected.has(item.id)));
  });
  // In editing mode, clicking a thumbnail/song selects it instead of playing it.
  list.addEventListener('click', event => {
    if (!active) return;
    const target = event.target.closest('[data-voice], [data-song], [data-sticker]');
    if (!target) return;
    event.preventDefault(); event.stopImmediatePropagation();
    const id = target.dataset.voice || target.dataset.song || target.dataset.sticker;
    if (selected.has(id)) selected.delete(id); else selected.add(id);
    render();
  }, true);
  return {
    checkbox(item) {
      const label = document.createElement('label'); label.className = 'check batch-selection';
      const input = document.createElement('input'); input.type = 'checkbox'; input.dataset.batchSelect = item.id;
      input.checked = selected.has(item.id); input.setAttribute('aria-label', '选择编辑' + item.label);
      label.append(input, document.createTextNode('选择编辑'));
      input.addEventListener('change', () => { if (input.checked) selected.add(item.id); else selected.delete(item.id); render(); });
      return label;
    },
    categoryButton(category, groupItems) {
      const button = document.createElement('button'); button.type = 'button'; button.className = 'media-edit-button batch-selection';
      button.textContent = '选中本分类'; button.dataset.batchCategory = category;
      button.disabled = !groupItems.length;
      button.addEventListener('click', event => { event.preventDefault(); event.stopPropagation(); groupItems.forEach(item => selected.add(item.id)); render(); });
      return button;
    },
    update(nextItems, nextEditor) {
      items = nextItems; editor = nextEditor;
      selected = new Set([...selected].filter(id => items.some(item => item.id === id)));
      render();
    },
  };
}
