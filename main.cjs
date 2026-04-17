const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');

const isDev = process.env.NODE_ENV === 'development';

if (isDev) {
  app.setPath('userData', path.join(app.getPath('userData'), 'electron-dev'));
}

const NORMAL_SIZE = { width: 350, height: 600 };
const FOCUS_SIZE = { width: 320, height: 48 };

let mainWindow = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    ...NORMAL_SIZE,
    alwaysOnTop: true,
    autoHideMenuBar: true,
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 12, y: 10 },
    titleBarOverlay: {
      color: '#09090b',
      symbolColor: '#a1a1aa',
      height: 36
    },
    backgroundColor: '#09090b',
    vibrancy: undefined,
    hasShadow: true,
    roundedCorners: true,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false
    }
  });

  if (isDev) {
    mainWindow.loadURL('http://localhost:3000');
  } else {
    mainWindow.loadFile(path.join(__dirname, 'dist', 'index.html'));
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

ipcMain.on('enter-focus-mode', () => {
  if (!mainWindow) return;
  if (mainWindow.setWindowButtonVisibility) mainWindow.setWindowButtonVisibility(false);
  mainWindow.setResizable(false);
  mainWindow.setSize(FOCUS_SIZE.width, FOCUS_SIZE.height, true);
  mainWindow.setOpacity(0.5);
  mainWindow.setAlwaysOnTop(true, 'floating');
});

ipcMain.on('exit-focus-mode', () => {
  if (!mainWindow) return;
  if (mainWindow.setWindowButtonVisibility) mainWindow.setWindowButtonVisibility(true);
  mainWindow.setResizable(true);
  mainWindow.setOpacity(1.0);
  mainWindow.setSize(NORMAL_SIZE.width, NORMAL_SIZE.height, true);
  mainWindow.setAlwaysOnTop(true);
});

app.whenReady().then(() => {
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
