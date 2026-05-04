const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  showNotification: (options) => ipcRenderer.send('show-notification', options),
  getNotificationPreference: () => ipcRenderer.invoke('get-notification-preference'),
  setNotificationPreference: (enabled) => ipcRenderer.send('set-notification-preference', enabled),
  onNavigateToChannel: (callback) => ipcRenderer.on('navigate-to-channel', (_event, channelUrl) => callback(channelUrl))
});