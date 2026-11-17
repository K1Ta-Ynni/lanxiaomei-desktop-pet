import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';

// Optional Windows speech recognition. No recording files or audio uploads.
export class SpeechInput {
  child = null;
  get running() { return this.child !== null; }
  constructor(script, onEvent) { this.script = script; this.onEvent = onEvent; }
  async languages() {
    if (process.platform !== 'win32') return [];
    return await new Promise(resolve => {
      const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', this.script, '-Mode', 'probe'], { windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] });
      let output = '';
      const timer = setTimeout(() => { child.kill(); resolve([]); }, 8000);
      child.stdout.setEncoding('utf8');
      child.stdout.on('data', chunk => { if (output.length < 16000) output += chunk; });
      child.on('error', () => { clearTimeout(timer); resolve([]); });
      child.on('exit', code => {
        clearTimeout(timer);
        if (code !== 0) return resolve([]);
        try { resolve(JSON.parse(output.trim()).languages || []); } catch { resolve([]); }
      });
    });
  }
  start({ mode = 'once', culture, wakePhrase = '蓝小妹' } = {}) {
    if (process.platform !== 'win32') throw new Error('语音输入当前需要 Windows 语音识别组件。');
    this.stop();
    const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', this.script, '-Mode', mode, '-Culture', culture || 'default', '-WakePhrase', wakePhrase.slice(0, 50)], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    this.child = child;
    let failed = false;
    const lines = createInterface({ input: child.stdout });
    lines.on('line', line => {
      if (this.child !== child) return;
      try {
        const event = JSON.parse(line.replace(/^\uFEFF/u, ''));
        if (event.type === 'error') { failed = true; this.child = null; child.kill(); }
        this.onEvent(event);
      } catch { /* Ignore diagnostic output from the OS recognizer. */ }
    });
    child.on('error', () => {
      if (this.child !== child) return;
      failed = true; this.child = null;
      this.onEvent({ type: 'error', message: '无法启动 Windows 语音识别。' });
    });
    child.on('exit', () => {
      lines.close();
      if (this.child !== child) return;
      this.child = null;
      if (!failed) this.onEvent({ type: 'stopped' });
    });
    return { mode };
  }
  stop() {
    const child = this.child;
    this.child = null;
    child?.kill();
    if (child) this.onEvent({ type: 'stopped' });
  }
}
