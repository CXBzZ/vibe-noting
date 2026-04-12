const { app, BrowserWindow } = require('electron');
const path = require('path');

const isDev = process.env.NODE_ENV === 'development';

function createWindow() {
  const win = new BrowserWindow({
    width: 350,
    height: 600,
    alwaysOnTop: true, // 核心：始终置顶
    autoHideMenuBar: true, // 隐藏菜单栏
    titleBarStyle: 'hidden', // 隐藏默认标题栏，保留控制按钮（Mac 的红绿灯，Win 的最小化/关闭）
    trafficLightPosition: { x: 16, y: 16 }, // Mac 红绿灯位置优化
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
