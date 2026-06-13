import { clipboard, contextBridge, ipcRenderer, webUtils } from 'electron';
import type {
  AttachmentSaveRequest,
  ExportRequest,
  LoadResult,
  MsgViewerApi
} from '@shared/types';

/**
 * Única superficie expuesta al renderer (§7.3): contextBridge con el
 * contrato tipado MsgViewerApi. Sin acceso a Node en el renderer.
 */

const api: MsgViewerApi & { openDroppedFile(file: File): Promise<LoadResult> } = {
  openFileDialog: () => ipcRenderer.invoke('dialog:open'),
  openPath: (path) => ipcRenderer.invoke('open-path', path),
  openEmbedded: (attachmentId) => ipcRenderer.invoke('open-embedded', attachmentId),
  saveAttachments: (req: AttachmentSaveRequest) => ipcRenderer.invoke('attachments:save', req),
  exportDocument: (req: ExportRequest) => ipcRenderer.invoke('export', req),
  showInFolder: (path) => ipcRenderer.send('show-in-folder', path),
  onDocumentLoaded: (cb) => {
    ipcRenderer.on('document-loaded', (_event, result: LoadResult) => cb(result));
  },
  onMenuAction: (cb) => {
    ipcRenderer.on('menu-action', (_event, action) => cb(action));
  },
  copyText: (text) => clipboard.writeText(text),
  saveAs: () => ipcRenderer.invoke('save-as'),
  clearDocument: () => ipcRenderer.invoke('clear-document'),
  viewSource: () => ipcRenderer.send('view-source'),
  zoom: (delta) => ipcRenderer.send('zoom', delta),
  showAbout: () => ipcRenderer.send('show-about'),
  openExternal: (url) => ipcRenderer.send('open-external', url),
  printDocument: () => ipcRenderer.invoke('print'),
  showAttachmentMenu: (attachmentId) => ipcRenderer.send('attachment-menu', attachmentId),
  onToast: (cb) => {
    ipcRenderer.on('toast', (_event, t) => cb(t));
  },
  getLocale: () => ipcRenderer.invoke('get-locale'),
  getCurrentDocument: () => ipcRenderer.invoke('get-current-document'),
  // FR-02b: el renderer no conoce rutas; webUtils las resuelve en el preload.
  openDroppedFile: (file: File) => {
    const path = webUtils.getPathForFile(file);
    return ipcRenderer.invoke('open-path', path);
  }
};

contextBridge.exposeInMainWorld('msgViewer', api);
