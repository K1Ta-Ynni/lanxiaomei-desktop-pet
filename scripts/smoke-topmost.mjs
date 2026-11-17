import assert from 'node:assert/strict';
import {mkdtemp,cp,mkdir,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {_electron as electron} from 'playwright';
import {execFileSync} from 'node:child_process';
const root=resolve(fileURLToPath(new URL('..', import.meta.url))), temp=await mkdtemp(join(tmpdir(),'lanxiaomei-topmost-'));
let desktop;
try {
 const fixture=join(temp,'app'),data=join(temp,'data');await mkdir(fixture);await mkdir(data);
 for(const name of ['src','assets','character','package.json'])await cp(join(root,name),join(fixture,name),{recursive:true});
 await writeFile(join(fixture,'assets/voices/manifest.json'),'{"clips":[]}');
 await writeFile(join(data,'preferences.json'),JSON.stringify({muted:true,idleActions:false,autoBlink:false,portraitMode:'normal'}));
 const env={...process.env,PET_STARTER_DATA_DIR:data};delete env.ELECTRON_RUN_AS_NODE;delete env.NODE_OPTIONS;
 desktop=await electron.launch({args:[fixture],cwd:root,env,timeout:40000});const pet=await desktop.firstWindow();await pet.locator('#greeting').waitFor({state:'visible'});
 const initial=await desktop.evaluate(async({BrowserWindow})=>{
  const pet=BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().endsWith('/pet.html'));
  globalThis.petTest=pet;globalThis.topmostCalls=0;
  const original=pet.setAlwaysOnTop.bind(pet);pet.setAlwaysOnTop=(...args)=>{if(args[0])globalThis.topmostCalls++;return original(...args);};
  const other=new BrowserWindow({width:360,height:180,show:true});await other.loadURL('data:text/html,Focus test');other.focus();globalThis.focusTest=other;
  pet.setAlwaysOnTop(false);return {bounds:pet.getBounds(),focused:BrowserWindow.getFocusedWindow()?.id};
 });
 await pet.waitForTimeout(1200);
 const recovered=await desktop.evaluate(({BrowserWindow})=>({visible:globalThis.petTest.isVisible(),minimized:globalThis.petTest.isMinimized(),top:globalThis.petTest.isAlwaysOnTop(),bounds:globalThis.petTest.getBounds(),calls:globalThis.topmostCalls,focused:BrowserWindow.getFocusedWindow()?.id}));
 console.log({initial,recovered});
 const hwnd=await desktop.evaluate(()=>globalThis.petTest.getNativeWindowHandle().readBigUInt64LE().toString());
 if (process.platform === 'win32') {
  const style = Number(execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
   `Add-Type -TypeDefinition 'using System; using System.Runtime.InteropServices; public class NativeCheck { [DllImport("user32.dll")] public static extern int GetWindowLong(IntPtr h, int i); }'; [NativeCheck]::GetWindowLong([IntPtr]::new(${hwnd}),-20);`
  ], {encoding:'utf8', windowsHide:true}).trim());
  assert.ok(style & 8, 'Windows WS_EX_TOPMOST must actually be set');
 }
 assert.equal(recovered.top,true);assert.ok(recovered.calls>=2);assert.deepEqual(recovered.bounds,initial.bounds);assert.equal(recovered.focused,initial.focused,'periodic topmost must not steal focus');
 await pet.evaluate(()=>window.petApp.setGameMode(true));
 assert.equal(await desktop.evaluate(()=>globalThis.petTest.isFocusable()),false);
 const result=await pet.evaluate(()=>window.petApp.executeInteraction({type:'jump'}));assert.equal(result.performed,true);
 await pet.waitForFunction(()=>document.querySelector('#pet').classList.contains('action-jump'));
 await pet.evaluate(()=>window.petApp.executeInteraction({type:'showExpression',id:'happy'}));
 await pet.waitForFunction(()=>document.querySelector('#pet img').getAttribute('src').endsWith('/portrait-happy.png'));
 await pet.evaluate(()=>window.petApp.setPetHidden(true));
 const hiddenCalls=await desktop.evaluate(()=>globalThis.topmostCalls);await pet.waitForTimeout(1100);
 assert.equal(await desktop.evaluate(()=>globalThis.topmostCalls),hiddenCalls,'hidden pet must not reassert topmost');
 assert.equal(await desktop.evaluate(()=>globalThis.petTest.isVisible()),false);
 await pet.evaluate(()=>window.petApp.setGameMode(false));assert.equal(await desktop.evaluate(()=>globalThis.petTest.isVisible()),false);
 await pet.evaluate(()=>window.petApp.setPetHidden(false));
 assert.equal(await desktop.evaluate(()=>globalThis.petTest.isVisible()&&globalThis.petTest.isAlwaysOnTop()),true);
 console.log('PASS: native topmost recovers periodically without focus/size/position changes; hidden stays hidden and pauses topmost; game mode permits animations/expressions/panel commands.');
}finally{await desktop?.close().catch(()=>{});await rm(temp,{recursive:true,force:true});}
