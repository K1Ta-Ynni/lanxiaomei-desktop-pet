const status = document.querySelector('#update-result');
const check = document.querySelector('#check-updates');
const download = document.querySelector('#download-update');
const install = document.querySelector('#install-update');
const cancel = document.querySelector('#cancel-update');
const showFile = document.querySelector('#show-update');
const progress = document.querySelector('#update-progress');
const editionSelect = document.querySelector('#update-edition');
let canInstall = false;
let editionInitialized = false;

function render(state) {
  if (state.canInstall !== undefined) canInstall = state.canInstall;
  const editionNames = { basic: '基础版', companion: '陪伴版' };
  document.querySelector('#current-version').textContent = `当前安装：${editionNames[state.currentEdition] || '基础版'} v${state.currentVersion}${canInstall ? '' : '（源码运行）'}`;
  if (!editionInitialized) { editionSelect.value = state.currentEdition || 'basic'; editionInitialized = true; }
  const busy = ['checking', 'downloading', 'verifying', 'preparing', 'installing'].includes(state.phase);
  check.disabled = busy;
  document.querySelector('#include-prereleases').disabled = busy;
  editionSelect.disabled = busy;
  download.hidden = !state.release?.available || !state.release?.asset || ['downloaded', 'preparing', 'installing'].includes(state.phase);
  download.textContent = state.targetEdition && state.targetEdition !== state.currentEdition
    ? `下载并切换到${editionNames[state.targetEdition] || state.targetEdition}` : '下载新版';
  download.disabled = busy;
  install.hidden = !canInstall || !['downloaded', 'preparing', 'installing'].includes(state.phase);
  install.disabled = busy;
  showFile.hidden = state.phase !== 'downloaded';
  cancel.hidden = !['downloading', 'verifying'].includes(state.phase);
  progress.hidden = !['downloading', 'verifying'].includes(state.phase);
  progress.value = state.total ? state.received / state.total * 100 : 0;
  const notes = document.querySelector('#update-notes');
  notes.textContent = state.release?.notes || '';
  notes.hidden = !notes.textContent;
  const mb = value => (value / 1024 / 1024).toFixed(1);
  const labels = {
    idle: '点击检查更新，获取 GitHub 上的最新版本。', checking: '正在检查 GitHub 版本…',
    current: state.release ? '当前已是此更新通道的最新版本。' : '暂时没有发布版本。',
    available: `发现 v${state.release?.version}${state.release?.prerelease ? ' 预览版' : ''}。${state.release?.asset ? '' : '此版本还没有适合本机的完整附件，请打开发布页查看。'}`,
    downloading: `正在下载：${mb(state.received)} / ${mb(state.total)} MB（${Math.round(progress.value)}%）`,
    verifying: '下载完成，正在校验 SHA-256…', downloaded: canInstall ? '下载并校验完成，点击“更新并重启”即可原位升级。' : '下载并校验完成。源码运行不自动替换，请查看下载文件或通过 Git 更新。',
    preparing: '正在解压检查新版，随后退出并原位更新…', installing: '正在退出并更新，完成后自动重启。',
    cancelled: '已取消下载。', error: state.error || '更新失败，请稍后重试。',
  };
  if (state.phase === 'current') labels.current = state.targetEdition !== state.currentEdition
    ? '该类别暂时没有兼容当前系统的发布包。'
    : state.release && !state.release.asset ? `发现 v${state.release.version}，但没有兼容当前系统的安装包。`
      : state.release ? '当前已是此类别的最新版本。' : '该类别暂时没有发布版本。';
  if (state.phase === 'available') labels.available = state.targetEdition !== state.currentEdition
    ? `找到${editionNames[state.targetEdition] || '目标类别'} v${state.release?.version}，可切换安装。`
    : `发现新版 v${state.release?.version}${state.release?.prerelease ? '（预览版）' : ''}。${state.release?.asset ? '' : '此版本没有适用于当前系统的完整安装包，请打开发布页查看。'}`;
  status.textContent = labels[state.phase] || '';
  status.className = 'result' + (state.phase === 'error' ? ' error' : '');
}
function fail(error) { status.className = 'result error'; status.textContent = error.message; }
check.addEventListener('click', () => window.petApp.checkUpdates({
  includePrereleases: document.querySelector('#include-prereleases').checked,
  edition: editionSelect.value,
}).then(render).catch(fail));
editionSelect.addEventListener('change', () => {
  download.hidden = true;
  install.hidden = true;
  showFile.hidden = true;
  document.querySelector('#update-notes').hidden = true;
  status.className = 'result';
  status.textContent = `目标类别已改为${editionSelect.selectedOptions[0].textContent}，请重新检查更新。`;
});
download.addEventListener('click', () => window.petApp.downloadUpdate().then(render).catch(fail));
install.addEventListener('click', () => window.petApp.installUpdate().catch(fail));
cancel.addEventListener('click', () => window.petApp.cancelUpdate());
showFile.addEventListener('click', () => window.petApp.showUpdateFile().catch(fail));
document.querySelector('#release-page').addEventListener('click', () => window.petApp.openReleases().catch(fail));
window.petApp.onUpdate(render);
window.petApp.onUpdateFocus(() => document.querySelector('#updates-section').scrollIntoView({ behavior: 'smooth' }));
window.petApp.updateStatus().then(render).catch(fail);
