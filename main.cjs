const { app, BrowserWindow } = require('electron');
const path = require('path');

const isDev = process.env.NODE_ENV === 'development';

function createWindow() {
  const win = new BrowserWindow({
    width: 350,
    height: 600,
    alwaysOnTop: true, // 核心：始终置顶
    autoHideMenuBar: true, // 隐藏菜单栏，看起来更像纯净的便签
    frame: false, // 无边框模式（可选，如果你想要完全自定义的标题栏，这里设为 false。为了方便拖拽，我们先保留系统边框，但隐藏菜单）
    titleBarStyle: 'hidden', // 隐藏默认标题栏，但保留窗口控制按钮（Windows 11 效果很好）
    titleBarOverlay: {
      color: '#09090b',
      symbolColor: '#eab308',
      height: 40
    },
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false
    }
  });

  if (isDev) {
    // 开发环境下加载 Vite 本地服务
    win.loadURL('http://localhost:3000');
  } else {
    // 生产环境下加载打包后的静态文件
    win.loadFile(path.join(__dirname, 'dist', 'index.html'));
  }
}

app.whenReady().then(() => {
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
