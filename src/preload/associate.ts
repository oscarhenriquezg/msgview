import { contextBridge, ipcRenderer } from 'electron';

/** API de la ventana de asociación de tipos de archivo. */
contextBridge.exposeInMainWorld('associateApi', {
  confirm: (exts: string[]) => ipcRenderer.send('associate-confirm', exts),
  cancel: () => ipcRenderer.send('associate-cancel')
});
