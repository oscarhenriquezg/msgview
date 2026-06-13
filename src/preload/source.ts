import { contextBridge, ipcRenderer } from 'electron';

/** API mínima de la ventana de código fuente: copiar, imprimir, exportar. */
contextBridge.exposeInMainWorld('sourceApi', {
  copy: (which: 'headers' | 'body' | 'all') => ipcRenderer.send('source-copy', which),
  print: () => ipcRenderer.send('source-print'),
  exportAs: (format: 'pdf' | 'html' | 'txt') => ipcRenderer.invoke('source-export', format)
});
