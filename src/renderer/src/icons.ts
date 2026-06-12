/**
 * Iconos Lucide (https://lucide.dev, licencia ISC), inlineados en build:
 * cero peticiones en runtime (NFR-03/04).
 */
import circleOff from 'lucide-static/icons/circle-off.svg?raw';
import filePlusCorner from 'lucide-static/icons/file-plus-corner.svg?raw';
import fileSearchCorner from 'lucide-static/icons/file-search-corner.svg?raw';
import folderOpen from 'lucide-static/icons/folder-open.svg?raw';
import origami from 'lucide-static/icons/origami.svg?raw';
import printer from 'lucide-static/icons/printer.svg?raw';
import save from 'lucide-static/icons/save.svg?raw';
import squareArrowUpRight from 'lucide-static/icons/square-arrow-up-right.svg?raw';
import unlink from 'lucide-static/icons/unlink.svg?raw';
import zoomIn from 'lucide-static/icons/zoom-in.svg?raw';
import zoomOut from 'lucide-static/icons/zoom-out.svg?raw';

export const ICONS = {
  new: filePlusCorner,
  open: folderOpen,
  save,
  print: printer,
  search: fileSearchCorner,
  export: squareArrowUpRight,
  zoomIn,
  zoomOut,
  zoomReset: circleOff,
  unlink,
  about: origami
} as const;
