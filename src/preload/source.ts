import { contextBridge, ipcRenderer } from 'electron';

/** API mínima de la ventana de código fuente: copiar, imprimir, exportar. */
contextBridge.exposeInMainWorld('sourceApi', {
  copy: (which: 'headers' | 'body' | 'all') => ipcRenderer.send('source-copy', which),
  copyText: (text: string) => ipcRenderer.send('source-copy-text', text),
  print: () => ipcRenderer.send('source-print'),
  exportAs: (format: 'pdf' | 'html' | 'txt') => ipcRenderer.invoke('source-export', format)
});
