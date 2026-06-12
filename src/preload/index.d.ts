import type { LoadResult, MsgViewerApi } from '@shared/types';

declare global {
  interface Window {
    msgViewer: MsgViewerApi & { openDroppedFile(file: File): Promise<LoadResult> };
  }
}

export {};
