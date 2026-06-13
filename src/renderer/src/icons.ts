/**
 * Iconos Lucide (https://lucide.dev, licencia ISC), inlineados en build:
 * cero peticiones en runtime (NFR-03/04).
 */
import braces from 'lucide-static/icons/braces.svg?raw';
import contrast from 'lucide-static/icons/contrast.svg?raw';
import copy from 'lucide-static/icons/copy.svg?raw';
import filePlusCorner from 'lucide-static/icons/file-plus-corner.svg?raw';
import fileSearchCorner from 'lucide-static/icons/file-search-corner.svg?raw';
import folderOpen from 'lucide-static/icons/folder-open.svg?raw';
import origami from 'lucide-static/icons/origami.svg?raw';
import printer from 'lucide-static/icons/printer.svg?raw';
import save from 'lucide-static/icons/save.svg?raw';
import shieldCheck from 'lucide-static/icons/shield-check.svg?raw';
import squareCode from 'lucide-static/icons/square-code.svg?raw';
import squareDashedText from 'lucide-static/icons/square-dashed-text.svg?raw';
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
  copy,
  export: squareArrowUpRight,
  zoomIn,
  zoomOut,
  darkBody: contrast,
  unlink,
  shield: shieldCheck,
  metaJson: braces,
  metaTxt: squareDashedText,
  source: squareCode,
  about: origami
} as const;
