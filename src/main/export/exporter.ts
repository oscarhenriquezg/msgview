import { writeFile } from 'node:fs/promises';
import { app, BrowserWindow, clipboard } from 'electron';
import { MAX_PNG_HEIGHT, type ExportResult, type MsgDocument } from '@shared/types';
import { MsgAdapter } from '../parser/MsgAdapter';
import { buildEml } from './eml';
import { buildPrintableHtml } from './printable';

/**
 * Pipeline de exportación (§7.4):
 *  - PDF/PNG: ventana oculta con el documento imprimible → printToPDF / capturePage.
 *  - EML: reconstrucción desde el modelo parseado, nunca desde el DOM.
 *
 * El HTML imprimible se sirve vía protocolo en memoria msgprint://
 * (registrado en index.ts); nunca se escriben temporales con contenido
 * del correo (NFR-03/04). El cuerpo ya está sanitizado y la CSP de la
 * plantilla (default-src 'none') impide ejecutar cualquier script del
 * contenido; executeJavaScript del host no está sujeto a esa CSP.
 */

const PRINT_WIDTH = 900;

let printableHtml = '';

/** Consumido por el protocolo msgprint:// registrado en index.ts. */
export function getPrintableHtml(): string {
  return printableHtml;
}

async function withPrintWindow<T>(
  doc: MsgDocument,
  fn: (win: BrowserWindow) => Promise<T>,
  opts: { offscreen?: boolean } = {}
): Promise<T> {
  printableHtml = buildPrintableHtml(doc, app.getLocale());
  const win = new BrowserWindow({
    show: false,
    width: PRINT_WIDTH,
    height: 1200,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      // capturePage necesita generación de frames; una ventana oculta normal
      // no los produce en Linux. El modo offscreen sí (FR-13).
      offscreen: opts.offscreen ?? false,
      backgroundThrottling: false
    }
  });
  try {
    await win.loadURL('msgprint://export/current.html');
    return await fn(win);
  } finally {
    win.destroy();
    printableHtml = '';
  }
}

/** A4 salvo locales con tamaño Carta (FR-11). */
function pageSizeForLocale(): 'A4' | 'Letter' {
  const region = app.getLocale().split('-')[1]?.toUpperCase();
  return region && ['US', 'CA', 'MX', 'CL', 'CO', 'PH'].includes(region) ? 'Letter' : 'A4';
}

export async function exportPdf(doc: MsgDocument, filePath: string): Promise<ExportResult> {
  try {
    return await withPrintWindow(doc, async (win) => {
      const data = await win.webContents.printToPDF({
        pageSize: pageSizeForLocale(),
        printBackground: true
      });
      await writeFile(filePath, data);
      return { ok: true, filePath } satisfies ExportResult;
    });
  } catch (e) {
    return { ok: false, reason: 'error', detail: e instanceof Error ? e.message : String(e) };
  }
}

async function contentHeightOf(win: BrowserWindow): Promise<number> {
  const h = (await win.webContents.executeJavaScript(
    'document.documentElement.scrollHeight'
  )) as number;
  return Math.max(Math.ceil(h), 100);
}

/** Altura total del render, para decidir el truncado antes de pedir destino (FR-13). */
export async function measurePngHeight(doc: MsgDocument): Promise<number | null> {
  try {
    return await withPrintWindow(doc, contentHeightOf, { offscreen: true });
  } catch {
    return null;
  }
}

/**
 * FR-13: captura a altura completa con límite MAX_PNG_HEIGHT. Si el contenido
 * lo excede y el usuario aún no aceptó truncar, devuelve png-too-tall para
 * que el renderer pregunte (truncar / cancelar / sugerir PDF).
 */
export async function exportPng(
  doc: MsgDocument,
  filePath: string,
  acceptTruncation: boolean
): Promise<ExportResult> {
  try {
    return await withPrintWindow(doc, async (win) => {
      const contentHeight = await contentHeightOf(win);
      if (contentHeight > MAX_PNG_HEIGHT && !acceptTruncation) {
        return { ok: false, reason: 'png-too-tall', contentHeight } satisfies ExportResult;
      }
      const height = Math.min(contentHeight, MAX_PNG_HEIGHT);
      win.setContentSize(PRINT_WIDTH, height);
      // Deja estabilizar el layout tras el resize antes de capturar.
      await new Promise((r) => setTimeout(r, 200));
      const image = await win.webContents.capturePage({
        x: 0,
        y: 0,
        width: PRINT_WIDTH,
        height
      });
      await writeFile(filePath, image.toPNG());
      return { ok: true, filePath } satisfies ExportResult;
    }, { offscreen: true });
  } catch (e) {
    return { ok: false, reason: 'error', detail: e instanceof Error ? e.message : String(e) };
  }
}

/** Variante de FR-13: la captura va al portapapeles en vez de a disco. */
export async function exportPngToClipboard(
  doc: MsgDocument,
  acceptTruncation: boolean
): Promise<ExportResult> {
  try {
    return await withPrintWindow(
      doc,
      async (win) => {
        const contentHeight = await contentHeightOf(win);
        if (contentHeight > MAX_PNG_HEIGHT && !acceptTruncation) {
          return { ok: false, reason: 'png-too-tall', contentHeight } satisfies ExportResult;
        }
        const height = Math.min(contentHeight, MAX_PNG_HEIGHT);
        win.setContentSize(PRINT_WIDTH, height);
        await new Promise((r) => setTimeout(r, 200));
        const image = await win.webContents.capturePage({
          x: 0,
          y: 0,
          width: PRINT_WIDTH,
          height
        });
        clipboard.writeImage(image);
        return { ok: true } satisfies ExportResult;
      },
      { offscreen: true }
    );
  } catch (e) {
    return { ok: false, reason: 'error', detail: e instanceof Error ? e.message : String(e) };
  }
}

/**
 * Impresión con el diálogo del sistema sobre el documento imprimible
 * (cabecera + cuerpo), no sobre la UI de la aplicación.
 */
export async function printDocument(doc: MsgDocument): Promise<ExportResult> {
  try {
    return await withPrintWindow(doc, (win) =>
      new Promise<ExportResult>((resolve) => {
        win.webContents.print({ printBackground: true }, (success, failureReason) => {
          if (success) resolve({ ok: true });
          else if (/cancel/i.test(failureReason)) resolve({ ok: false, reason: 'cancelled' });
          else resolve({ ok: false, reason: 'error', detail: failureReason });
        });
      })
    );
  } catch (e) {
    return { ok: false, reason: 'error', detail: e instanceof Error ? e.message : String(e) };
  }
}

export async function exportEml(sourceBuffer: Buffer, filePath: string): Promise<ExportResult> {
  try {
    const parts = MsgAdapter.getEmlParts(sourceBuffer);
    if (!parts) return { ok: false, reason: 'error', detail: 'No se pudo extraer el modelo MAPI' };
    await writeFile(filePath, buildEml(parts), 'utf-8');
    return { ok: true, filePath };
  } catch (e) {
    return { ok: false, reason: 'error', detail: e instanceof Error ? e.message : String(e) };
  }
}
