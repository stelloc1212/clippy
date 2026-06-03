const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('clippy', {
  chat: (payload) => ipcRenderer.invoke('chat', payload),
  pickFiles: () => ipcRenderer.invoke('pick-files'),
  browserTask: (text) => ipcRenderer.invoke('browser-task', text),
  look: (question) => ipcRenderer.invoke('look', question),
  getState: () => ipcRenderer.invoke('get-state'),
  setBudgets: (b) => ipcRenderer.invoke('set-budgets', b),
  resetSession: () => ipcRenderer.invoke('reset-session'),
  setModel: (m) => ipcRenderer.invoke('set-model', m),
  togglePin: () => ipcRenderer.invoke('toggle-pin'),
  setChatOpen: (v) => ipcRenderer.send('set-chat-open', v),
  dragStart: (off) => ipcRenderer.send('drag-start', off),
  dragEnd: () => ipcRenderer.send('drag-end'),
  quit: () => ipcRenderer.send('quit'),
  onWalking: (cb) => ipcRenderer.on('clippy:walking', (_e, v) => cb(v)),
  onFacing: (cb) => ipcRenderer.on('clippy:facing', (_e, v) => cb(v)),
  onGaze: (cb) => ipcRenderer.on('clippy:gaze', (_e, v) => cb(v))
});
