const { app, BrowserWindow, session } = require('electron');
globalThis.permissionEvents = [];
app.whenReady().then(() => {
  for (const name of ['owner', 'guest']) {
    const isolated = session.fromPartition(`p2p-acceptance-${name}`);
    isolated.setPermissionCheckHandler((_webContents, permission) => {
      globalThis.permissionEvents.push({ kind: 'check', permission }); return false;
    });
    isolated.setPermissionRequestHandler((_webContents, permission, callback) => {
      globalThis.permissionEvents.push({ kind: 'request', permission }); callback(false);
    });
    const window = new BrowserWindow({ show: false, webPreferences: { session: isolated,
      sandbox: true, contextIsolation: true, nodeIntegration: false, webSecurity: true } });
    window.loadURL('http://127.0.0.1:5184/tests/p2p/fixture.html');
  }
});
app.on('window-all-closed', () => app.quit());
