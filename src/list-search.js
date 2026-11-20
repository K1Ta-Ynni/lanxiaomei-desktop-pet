const normalize = value => String(value || '').normalize('NFKC').toLocaleLowerCase().trim();

// Filter existing rows so searches never change playlist membership or playback.
export function listSearch({ id, mount, targets, placeholder, compact = false }) {
  const bar = document.createElement('div');
  bar.className = 'list-search' + (compact ? ' compact' : '');
  const label = document.createElement('label');
  label.htmlFor = id;
  label.textContent = compact ? '搜索' : '搜索列表';
  const input = document.createElement('input');
  input.id = id;
  input.type = 'search';
  input.placeholder = placeholder;
  input.autocomplete = 'off';
  input.maxLength = 120;
  const clear = document.createElement('button');
  clear.type = 'button';
  clear.className = 'search-clear';
  clear.textContent = '×';
  clear.title = '清空搜索';
  clear.setAttribute('aria-label', '清空搜索');
  const status = document.createElement('span');
  status.className = 'search-count';
  status.setAttribute('role', 'status');
  bar.append(label, input, clear, status);
  mount.before(bar);
  const sections = targets.map(({ container, name, groups }) => {
    const empty = document.createElement('p');
    empty.className = 'search-empty';
    empty.textContent = '没有匹配的' + name + '，试试其他关键词。';
    empty.hidden = true;
    container.after(empty);
    return { container, name, groups, empty, collapsed: new Map() };
  });
  let searching = false;
  function refresh() {
    const terms = normalize(input.value).split(/\s+/u).filter(Boolean);
    const active = terms.length > 0;
    const counts = [];
    for (const section of sections) {
      const { container, name, groups, empty, collapsed } = section;
      const rows = [...container.querySelectorAll('[data-search-text]')];
      let matches = 0;
      for (const row of rows) {
        const text = normalize(row.dataset.searchText);
        row.hidden = !terms.every(term => text.includes(term));
        if (!row.hidden) ++matches;
      }
      const library = container.closest('details.library');
      const foldable = [library, ...(groups ? container.querySelectorAll(groups) : [])].filter(Boolean);
      for (const group of foldable) {
        if (active && !searching) collapsed.set(group, group.open);
        // New categories may be rendered while a search is active.
        if (active && !collapsed.has(group)) collapsed.set(group, group.open);
        group.hidden = group !== library && active && !group.querySelector('[data-search-text]:not([hidden])');
        if (active && !group.hidden) group.open = true;
        else if (!active && collapsed.has(group)) group.open = collapsed.get(group);
      }
      if (!active) collapsed.clear();
      else for (const group of collapsed.keys()) if (group !== library && !container.contains(group)) collapsed.delete(group);
      empty.hidden = !active || matches > 0;
      counts.push(`${name} ${matches}/${rows.length}`);
    }
    searching = active;
    clear.hidden = input.value.length === 0;
    status.textContent = active ? counts.join(' · ') : '';
  }
  input.addEventListener('input', refresh);
  input.addEventListener('search', refresh);
  input.addEventListener('keydown', event => {
    if (event.key === 'Escape' && input.value) {
      event.preventDefault();
      event.stopPropagation();
      input.value = '';
      refresh();
    }
  });
  clear.addEventListener('click', () => { input.value = ''; refresh(); input.focus(); });
  refresh();
  return { refresh };
}

export function searchable(row, item) {
  row.dataset.searchText = [item.label, item.category, item.group].filter(Boolean).join(' ');
  return row;
}
