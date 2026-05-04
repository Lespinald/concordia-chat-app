const { app, BrowserWindow, Menu, protocol, Tray, nativeImage, ipcMain, Notification } = require('electron');
const path = require('path');
const serve = require('electron-serve').default;

let Store;
let store;

const loadURL = serve({ directory: path.join(__dirname, '../web-app/out') });

// Reverted manual `app` protocol registration since electron-serve registers it internally automatically.
// protocol.registerSchemesAsPrivileged([...])

let mainWindow = null;
let tray = null;
let isQuitting = false;

// Force single instance to avoid zombie processes
const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  app.quit();
} else {
  app.on('second-instance', (event, commandLine, workingDirectory) => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      if (!mainWindow.isVisible()) mainWindow.show();
      mainWindow.focus();
    }
  });
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1024,
    height: 768,
    minWidth: 1024,
    minHeight: 768,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js')
    }
  });

  loadURL(mainWindow);

  const isMac = process.platform === 'darwin';

  const template = [
    ...(isMac
      ? [{
          label: app.name,
          submenu: [
            { role: 'about' },
            { type: 'separator' },
            { role: 'services' },
            { type: 'separator' },
            { role: 'hide' },
            { role: 'hideOthers' },
            { role: 'unhide' },
            { type: 'separator' },
            {
              label: 'Quit',
              accelerator: 'Command+Q',
              click: () => {
                isQuitting = true;
                app.quit();
              }
            }
          ]
        }]
      : []),
    {
      label: 'File',
      submenu: [
        isMac ? { role: 'close' } : {
          label: 'Quit',
          accelerator: 'Ctrl+Q',
          click: () => {
            isQuitting = true;
            app.quit();
          }
        }
      ]
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        ...(isMac
          ? [
              { role: 'pasteAndMatchStyle' },
              { role: 'delete' },
              { role: 'selectAll' }
            ]
          : [
              { role: 'delete' },
              { type: 'separator' },
              { role: 'selectAll' }
            ])
      ]
    },
    {
      label: 'View',
      submenu: [
        { role: 'reload' },
        { role: 'forceReload' },
        { 
          role: 'toggleDevTools', 
          accelerator: 'CommandOrControl+Shift+I' 
        },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' }
      ]
    },
    {
      label: 'Window',
      submenu: [
        { role: 'minimize' },
        { role: 'zoom' },
        ...(isMac
          ? [
              { type: 'separator' },
              { role: 'front' }
            ]
          : [
              { role: 'close' }
            ])
      ]
    }
  ];

  const menu = Menu.buildFromTemplate(template);
  Menu.setApplicationMenu(menu);

  mainWindow.on('close', (event) => {
    if (!isQuitting) {
      event.preventDefault();
      // Only hide the window on close to simulate minimization to tray
      mainWindow.hide();
    }
  });
}

function createTray() {
  const iconPath = path.join(__dirname, 'assets', 'tray-icon.png');
  // Load and scale explicitly to prevent missing/corrupt icon buffers in Linux GTK/Qt bounds
  const icon = nativeImage.createFromPath(iconPath).resize({ width: 16, height: 16 });
  tray = new Tray(icon);
  
  const contextMenu = Menu.buildFromTemplate([
    {
      label: 'Open',
      click: () => {
        if (mainWindow) {
          mainWindow.show();
          mainWindow.focus();
        } else {
          createWindow();
        }
      }
    },
    {
      label: 'Quit',
      click: () => {
        isQuitting = true;
        app.quit();
      }
    }
  ]);
  
  tray.setToolTip('Concordia');
  tray.setContextMenu(contextMenu);
  
  tray.on('click', () => {
    if (mainWindow) {
      if (mainWindow.isVisible()) {
         mainWindow.hide();
      } else {
         mainWindow.show();
         mainWindow.focus();
      }
    }
  });

  tray.on('double-click', () => {
    if (mainWindow) {
      mainWindow.show();
      mainWindow.focus();
    } else {
      createWindow();
    }
  });
}

// IPC Handlers for Notifications
ipcMain.handle('get-notification-preference', () => {
  return store.get('notificationsEnabled', true);
});

ipcMain.on('set-notification-preference', (event, enabled) => {
  store.set('notificationsEnabled', enabled);
});

ipcMain.on('show-notification', (event, { title, body, channelUrl }) => {
  const notificationsEnabled = store.get('notificationsEnabled', true);
  
  // Show notification only if enabled AND window is not focused (minimized, hidden, or blurred)
  if (notificationsEnabled && (!mainWindow || !mainWindow.isFocused())) {
    if (Notification.isSupported()) {
      const notification = new Notification({
        title,
        body: body.substring(0, 100), // Max 100 chars as requested
        icon: path.join(__dirname, 'assets', 'tray-icon.png')
      });
      
      notification.on('click', () => {
        if (mainWindow) {
          if (mainWindow.isMinimized()) mainWindow.restore();
          if (!mainWindow.isVisible()) mainWindow.show();
          mainWindow.focus();
          
          if (channelUrl) {
            mainWindow.webContents.send('navigate-to-channel', channelUrl);
          }
        }
      });
      
      notification.show();
    }
  }
});

app.on('before-quit', () => {
  isQuitting = true;
});

app.on('window-all-closed', (e) => {
  // Completely empty. We do nothing on window-all-closed.
  // This is the safest way to ensure the app never quits automatically on any OS.
});

app.whenReady().then(async () => {
  // Dynamic import for ESM-only electron-store v11+
  const { default: ElectronStore } = await import('electron-store');
  Store = ElectronStore;
  store = new Store({
    defaults: {
      notificationsEnabled: true
    }
  });

  // Request notification permission on macOS
  if (process.platform === 'darwin' && Notification.isSupported()) {
    // There is no explicit native prompt API for notifications in Electron (macOS asks automatically on first .show())
    // but requesting user attention via dock bounce validates system engagement
    app.dock.bounce();
  }

  createWindow();
  // Tray must be created AFTER ready but sometimes needs a slight tick in Linux
  setTimeout(createTray, 200);

  app.on('activate', function () {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
    else if (mainWindow) {
      mainWindow.show();
      mainWindow.focus();
    }
  });
});