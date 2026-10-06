const path = require('node:path');
const fs = require('node:fs');
const APP_ID = 'vn.rmreader.desktop';

function taskbarDetails({ isPackaged, executablePath, portablePath, exists = fs.existsSync }) {
  if (!isPackaged) return { appId: APP_ID };
  // NSIS runs Electron from a temporary extraction folder. Windows must pin the
  // original portable launcher, whose location survives closing the app.
  const validPortable = typeof portablePath === 'string' && path.win32.isAbsolute(portablePath) &&
    !/["\r\n]/.test(portablePath) && path.win32.extname(portablePath).toLowerCase() === '.exe' && exists(portablePath);
  const launcher = validPortable ? portablePath : executablePath;
  return {
    appId: APP_ID,
    appIconPath: launcher,
    appIconIndex: 0,
    relaunchCommand: `"${launcher}"`,
    relaunchDisplayName: 'RM Reader'
  };
}

function configureTaskbar(app, window) {
  if (process.platform !== 'win32') return;
  window.setAppDetails(taskbarDetails({ isPackaged: app.isPackaged, executablePath: process.execPath, portablePath: process.env.PORTABLE_EXECUTABLE_FILE }));
}
module.exports = { APP_ID, taskbarDetails, configureTaskbar };
