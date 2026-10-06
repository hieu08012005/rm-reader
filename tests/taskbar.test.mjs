import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { APP_ID, taskbarDetails } = require('../electron/taskbar.cjs');
const executablePath = 'C:\\Users\\ADMIN\\AppData\\Local\\Temp\\ns123.tmp\\app\\RM Reader.exe';
test('Portable taskbar command and icon use the original launcher, never temporary Electron', () => {
  const portablePath = 'E:\\App RM\\release\\RM-Reader-1.6.1.exe';
  const details = taskbarDetails({ isPackaged: true, executablePath, portablePath, exists: () => true });
  assert.equal(details.relaunchCommand, `"${portablePath}"`);
  assert.equal(details.appIconPath, portablePath);
  assert.equal(details.appId, APP_ID); assert.equal(details.relaunchDisplayName, 'RM Reader');
  assert.ok(!JSON.stringify(details).includes('ns123.tmp'));
});
test('Unpacked app pins its stable executable with a quoted path', () => {
  const stable = 'E:\\App_RM\\release\\win-unpacked\\RM Reader.exe';
  const details = taskbarDetails({ isPackaged: true, executablePath: stable });
  assert.equal(details.relaunchCommand, `"${stable}"`); assert.equal(details.appIconPath, stable);
});
test('Development instances set only identity and do not pin Electron without its app arguments', () => {
  assert.deepEqual(taskbarDetails({ isPackaged: false, executablePath, portablePath: 'E:\\test.exe' }), { appId: APP_ID });
});
test('Invalid or deleted portable environment paths cannot become the relaunch command', () => {
  for (const portablePath of ['relative.exe', 'E:\\app.exe" --unsafe', 'E:\\app\n.exe', 'E:\\app.cmd', 'E:\\deleted.exe']) {
    const details = taskbarDetails({ isPackaged: true, executablePath, portablePath, exists: () => portablePath !== 'E:\\deleted.exe' });
    assert.equal(details.relaunchCommand, `"${executablePath}"`);
  }
});
