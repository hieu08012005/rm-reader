import { _electron as electron } from 'playwright/test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const project = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const output = 'E:/App_RM/updates/1.6.1';
const executablePath = 'E:\\App_RM\\release\\win-unpacked\\RM Reader.exe';
const portablePath = 'E:\\App_RM\\release\\RM-Reader-1.6.1.exe';
const shortcutPath = 'E:\\App_RM\\RM Reader.lnk';
const checks = [];
let app;
function mark(name) { checks.push(name); console.log('PASS ' + name); }
async function start(portable = false) {
  const env = { ...process.env, RM_TEST_MODE: '1', RM_TEST_DATA: `${output}/taskbar-profile-${Date.now()}` };
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.PORTABLE_EXECUTABLE_FILE;
  if (portable) env.PORTABLE_EXECUTABLE_FILE = portablePath;
  app = await electron.launch({ executablePath, args: [], cwd: project, env });
  const page = await app.firstWindow();
  await page.waitForFunction(() => !!window.rmTest);
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].showInactive());
  const hwnd = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].getNativeWindowHandle().readBigUInt64LE().toString());
  return JSON.parse(execFileSync('powershell.exe', ['-NoProfile', '-File', path.join(project, 'tests/read-taskbar.ps1'), '-WindowHandle', hwnd], { encoding: 'utf8' }));
}
try {
  const fixed = await start();
  assert.equal(fixed.appId, 'vn.rmreader.desktop');
  assert.equal(fixed.relaunchCommand, `"${executablePath}"`);
  assert.equal(fixed.relaunchDisplayName, 'RM Reader');
  assert.ok(fixed.relaunchIcon.includes(executablePath));
  mark('Windows native taskbar properties point to the stable unpacked executable');
  const shortcut = await app.evaluate(({ shell }, { shortcutPath, executablePath, cwd }) => {
    const ok = shell.writeShortcutLink(shortcutPath, 'create', { target: executablePath, cwd, icon: executablePath, iconIndex: 0, appUserModelId: 'vn.rmreader.desktop', description: 'RM Reader — đọc tài liệu nhúng' });
    if (!ok) throw new Error('Shortcut creation failed');
    return shell.readShortcutLink(shortcutPath);
  }, { shortcutPath, executablePath, cwd: path.dirname(executablePath) });
  assert.equal(shortcut.target, executablePath);
  assert.equal(shortcut.appUserModelId, 'vn.rmreader.desktop');
  await app.close(); app = null;
  await fs.access(shortcut.target);
  mark('Workspace shortcut has the correct app identity and its target survives closing');
  const portable = await start(true);
  assert.equal(portable.relaunchCommand, `"${portablePath}"`);
  assert.equal(portable.relaunchDisplayName, 'RM Reader');
  assert.equal(portable.appId, 'vn.rmreader.desktop');
  assert.ok(portable.relaunchIcon.includes(portablePath));
  mark('Windows native taskbar properties use the original portable launcher when NSIS supplies its path');
  await app.close(); app = null;
  await start();
  mark('Packaged application restarts successfully after closing');
  await fs.writeFile(`${output}/taskbar-checks.json`, JSON.stringify({ checks, passed: checks.length, fixed, portable, shortcut }, null, 2));
} finally { if (app) await app.close(); }
