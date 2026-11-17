const pages = {
  home: ['互动小屋', '今天也来打个招呼吧'],
  voices: ['语音收藏', '把喜欢的声音，收进自己的互动列表'],
  stickers: ['表情口袋', '先看一眼，再冒个泡'],
  music: ['音乐播放器', '选一首歌，让蓝小妹陪你听'],
  preferences: ['偏好设置', '调成你喜欢的陪伴方式'],
  ai: ['AI 与模型', '可选文字聊天与记忆，不影响本地桌宠'],
  updates: ['版本与更新', '看看蓝小妹又学会了什么'],
};

export function showPage(page, focus = false) {
  if (!pages[page]) return;
  for (const panel of document.querySelectorAll('[data-panel]')) panel.hidden = panel.dataset.panel !== page;
  for (const button of document.querySelectorAll('[data-page]')) {
    if (button.dataset.page === page) button.setAttribute('aria-current', 'page');
    else button.removeAttribute('aria-current');
  }
  document.querySelector('#page-title').textContent = pages[page][0];
  document.querySelector('#page-description').textContent = pages[page][1];
  document.querySelector('.settings-form').scrollTop = 0;
  if (focus) document.querySelector('[data-panel="' + page + '"] h1, [data-panel="' + page + '"] h2')?.focus();
}
for (const button of document.querySelectorAll('[data-page]')) button.addEventListener('click', () => showPage(button.dataset.page));
window.petApp.onUpdateFocus(() => showPage('updates'));
window.petApp.onSettingsPage(page => showPage(page));
