const { app, BrowserWindow } = require('electron');
const path = require('path');

function createWindow(){
  const win = new BrowserWindow({
    width: 1100,
    height: 760,
    backgroundColor: '#f5f6fa',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });
  win.loadFile('index.html');
  if (process.argv.includes('--dev')) win.webContents.openDevTools();
}

app.whenReady().then(createWindow);
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
