document.querySelector('#composer').addEventListener('submit', event => event.preventDefault());
for (const id of ['settings', 'interactions']) document.getElementById(id).addEventListener('click', () => window.petApp.openSettings());
async function load() {
  const info = await window.petApp.info();
  document.querySelector('#name').textContent = info.name;
  document.querySelector('.identity img').src = '../' + info.avatar;
  document.title = info.name + ' | AI 聊天（功能暂未开放）';
}
void load().catch(error => { document.querySelector('#status').textContent = error.message; });
