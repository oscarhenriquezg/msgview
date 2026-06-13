import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test';

/**
 * E2E sobre la app construida (out/) con el corpus de fixtures.
 * Requiere `npm run build && npm run fixtures` previos.
 */

const ROOT = join(import.meta.dirname, '..', '..');
const FIXTURES = join(ROOT, 'tests', 'fixtures');

let app: ElectronApplication;
let page: Page;

async function launch(...args: string[]): Promise<void> {
  // userData aislado: no colisiona con una instancia del usuario en marcha.
  const userData = mkdtempSync(join(tmpdir(), 'msgviewer-userdata-'));
  app = await electron.launch({
    args: ['.', ...args],
    cwd: ROOT,
    env: { ...process.env, MSG_VIEWER_USER_DATA: userData }
  });
  page = await app.firstWindow();
}

test.afterEach(async () => {
  await app?.close();
});

/** Sustituye los diálogos nativos para que devuelvan una ruta fija. */
async function stubSaveDialog(filePath: string): Promise<void> {
  await app.evaluate(({ dialog }, path) => {
    dialog.showSaveDialog = async () => ({ canceled: false, filePath: path });
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [path] });
  }, filePath);
}

test('arranque sin archivo muestra el estado de bienvenida (FR-04)', async () => {
  await launch();
  await expect(page.locator('#drop-zone')).toBeVisible();
  await expect(page.locator('#btn-welcome-open')).toBeVisible();
});

test('apertura por argv renderiza metadatos, cuerpo y adjuntos (FR-02a, FR-06)', async () => {
  await launch(join(FIXTURES, 'html-basic.msg'));
  await expect(page.locator('#subject')).toHaveText('Informe trimestral Q2');
  await expect(page.locator('#meta-table')).toContainText('ana.perez@example.com');
  await expect(page.locator('#meta-table')).toContainText('oscar@example.com');
  await expect(page.locator('.chip')).toHaveCount(2);

  const frame = page.frameLocator('#body-frame');
  await expect(frame.locator('h1')).toHaveText('Informe');
});

test('correo hostil: sin ejecución de scripts en el iframe (criterio 2, FR-08)', async () => {
  await launch(join(FIXTURES, 'hostile-script.msg'));
  await expect(page.locator('#subject')).toHaveText('XSS attempt');

  const frame = page.frame({ url: /about:srcdoc/ }) ?? page.mainFrame().childFrames()[0];
  expect(frame).toBeTruthy();
  const pwned = await frame!.evaluate(() => (window as { PWNED?: boolean }).PWNED);
  expect(pwned).toBeUndefined();
  // El contenido visible sí se muestra (degradación con gracia).
  await expect(page.frameLocator('#body-frame').locator('p')).toContainText('Hola');
});

test('imagen inline cid: renderizada como data: URI (FR-09)', async () => {
  await launch(join(FIXTURES, 'inline-image.msg'));
  const img = page.frameLocator('#body-frame').locator('img');
  await expect(img).toHaveAttribute('src', /^data:image\/png;base64/);
});

test('archivo corrupto muestra error descriptivo y la app sigue operativa (FR-05)', async () => {
  await launch(join(FIXTURES, 'random-bytes.msg'));
  await expect(page.locator('#error-state')).toBeVisible();
  await expect(page.locator('#error-message')).toContainText('CFBF');
  await expect(page.locator('#btn-error-open')).toBeEnabled();
});

test('mensaje cifrado S/MIME informa sin crash (FR-05, §1.2)', async () => {
  await launch(join(FIXTURES, 'smime-encrypted.msg'));
  await expect(page.locator('#error-state')).toBeVisible();
  await expect(page.locator('#error-message')).toContainText(/cifrado|encrypted/i);
});

test.describe('exportaciones (FR-11/12/13, criterio 4)', () => {
  let dir: string;
  test.beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'msgviewer-e2e-'));
  });
  test.afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  test('exportar PDF produce un PDF válido', async () => {
    await launch(join(FIXTURES, 'html-basic.msg'));
    const out = join(dir, 'mensaje.pdf');
    await stubSaveDialog(out);
    await page.locator('#btn-export').click();
    await page.locator('#export-opt-pdf').click();
    await expect(page.locator('.toast')).toContainText('PDF');
    expect(readFileSync(out).subarray(0, 5).toString()).toBe('%PDF-');
  });

  test('exportar ZIP empaqueta el correo con sus adjuntos', async () => {
    await launch(join(FIXTURES, 'html-basic.msg'));
    await expect(page.locator('#subject')).toHaveText('Informe trimestral Q2');
    const out = join(dir, 'caso.zip');
    await stubSaveDialog(out);
    await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0]?.webContents.send('menu-action', {
        type: 'export',
        format: 'zip'
      })
    );
    await expect(page.locator('.toast')).toContainText('ZIP', { timeout: 15000 });
    const raw = readFileSync(out);
    expect(raw.subarray(0, 2).toString()).toBe('PK');
    expect(raw.toString('latin1')).toContain('attachments/informe.pdf');
  });

  test('exportar EML produce MIME con cabeceras estándar', async () => {
    await launch(join(FIXTURES, 'html-basic.msg'));
    const out = join(dir, 'mensaje.eml');
    await stubSaveDialog(out);
    await page.locator('#btn-export').click();
    await page.locator('#export-opt-eml').click();
    await expect(page.locator('.toast')).toContainText('EML');
    const eml = readFileSync(out, 'utf-8');
    expect(eml).toContain('From: ');
    expect(eml).toContain('Subject: ');
    expect(eml).toContain('MIME-Version: 1.0');
  });

  test('exportar PNG produce una imagen PNG', async () => {
    await launch(join(FIXTURES, 'html-basic.msg'));
    const out = join(dir, 'mensaje.png');
    await stubSaveDialog(out);
    // El menú Exportar → PNG abre un diálogo (archivo/portapapeles): se elige "archivo".
    await page.locator('#btn-export').click();
    await page.locator('#export-opt-png').click();
    await page.locator('#btn-png-target-file').click();
    await expect(page.locator('.toast')).toContainText('PNG', { timeout: 20_000 });
    const sig = readFileSync(out).subarray(0, 8);
    expect([...sig]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  });

  test('guardar adjunto conserva integridad binaria (criterio 3)', async () => {
    await launch(join(FIXTURES, 'html-basic.msg'));
    const out = join(dir, 'datos.csv');
    await stubSaveDialog(out);
    await page.locator('.chip', { hasText: 'datos.csv' }).locator('button').last().click();
    await expect(page.locator('.toast')).toBeVisible();
    expect(readFileSync(out, 'utf-8')).toBe('a;b;c\n1;2;3\n');
  });
});

test('Ver→Recargar conserva el documento (pull get-current-document)', async () => {
  await launch(join(FIXTURES, 'html-basic.msg'));
  await expect(page.locator('#subject')).toHaveText('Informe trimestral Q2');
  await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0]?.webContents.reload()
  );
  await expect(page.locator('#subject')).toHaveText('Informe trimestral Q2', { timeout: 10000 });
  await expect(page.locator('#empty-state')).toBeHidden();
});

test('abre archivos .eml (RFC 5322)', async () => {
  await launch(join(FIXTURES, 'sample.eml'));
  await expect(page.locator('#subject')).toHaveText('Correo EML de prueba');
  await expect(page.frameLocator('#body-frame').locator('h1')).toHaveText('EML');
  await expect(page.locator('.chip', { hasText: 'datos.csv' })).toBeVisible();
});

test('búsqueda en el mensaje (Ctrl+F) con contador', async () => {
  await launch(join(FIXTURES, 'html-basic.msg'));
  await expect(page.locator('#subject')).toHaveText('Informe trimestral Q2');
  await page.keyboard.press('Control+f');
  await expect(page.locator('#findbar')).toBeVisible();
  await page.locator('#find-input').fill('Informe');
  await expect(page.locator('#find-count')).toContainText(/\d+ (de|of) \d+/, { timeout: 5000 });
  await page.keyboard.press('Escape');
  await expect(page.locator('#findbar')).toBeHidden();
});

test('clic en enlace: advertencia antes de salir del visor', async () => {
  await launch(join(FIXTURES, 'html-basic.msg'));
  await expect(page.locator('#subject')).toHaveText('Informe trimestral Q2');
  // Acepta la advertencia y captura la URL que se abriría externamente.
  await app.evaluate(({ dialog, shell }) => {
    (globalThis as { __opened?: string }).__opened = '';
    dialog.showMessageBox = (async () => ({ response: 1, checkboxChecked: false })) as never;
    shell.openExternal = (async (url: string) => {
      (globalThis as { __opened?: string }).__opened = url;
    }) as never;
  });
  await page.frameLocator('#body-frame').locator('a', { hasText: 'Ver detalle' }).click();
  await expect
    .poll(() => app.evaluate(() => (globalThis as { __opened?: string }).__opened))
    .toBe('https://intranet.example.com/q2');
});

test('búsqueda propia desplaza hasta la coincidencia activa', async () => {
  await launch(join(FIXTURES, 'html-basic.msg'));
  await expect(page.locator('#subject')).toHaveText('Informe trimestral Q2');
  await page.keyboard.press('Control+f');
  await page.locator('#find-input').fill('detalle');
  await expect(page.locator('#find-count')).toContainText(/1 (de|of) 1/);
  // La coincidencia queda marcada como activa dentro del iframe.
  await expect(
    page.frameLocator('#body-frame').locator('mark.__find-active')
  ).toHaveText('detalle');
});

test('zoom y modo oscuro afectan solo al cuerpo; copiar vuelca su texto', async () => {
  await launch(join(FIXTURES, 'html-basic.msg'));
  await expect(page.locator('#subject')).toHaveText('Informe trimestral Q2');
  const body = page.frameLocator('#body-frame').locator('body');

  // Zoom: acercar/alejar cambian el zoom del cuerpo, no el de la ventana.
  await page.locator('#btn-zoom-in').click();
  await page.locator('#btn-zoom-in').click();
  await expect(body).toHaveCSS('zoom', '1.2');
  await expect.poll(() => app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0]?.webContents.getZoomLevel()
  )).toBe(0);

  // Modo oscuro (accesibilidad): clase __dark y estado aria-pressed.
  await page.locator('#btn-dark-body').click();
  await expect(body).toHaveClass(/__dark/);
  // Fondo oscuro y texto claro forzados (legibilidad WCAG 1.4.3), incluso para
  // texto con color inline propio.
  await expect(body).toHaveCSS('background-color', 'rgb(28, 28, 30)');
  await expect(body).toHaveCSS('color', 'rgb(230, 230, 230)');
  const para = page.frameLocator('#body-frame').locator('p').first();
  await expect(para).toHaveCSS('color', 'rgb(230, 230, 230)');
  await expect(page.locator('#btn-dark-body')).toHaveAttribute('aria-pressed', 'true');

  // Copiar sin selección: vuelca todo el cuerpo conservando el formato (HTML).
  await page.locator('#btn-copy').click();
  expect(await app.evaluate(({ clipboard }) => clipboard.readText())).toContain('Informe');
  expect(await app.evaluate(({ clipboard }) => clipboard.readHTML())).toMatch(/<(b|h1|p)\b/i);

  // Copiar con selección: solo lo seleccionado, también con su formato.
  await page.evaluate(() => {
    const frame = document.querySelector('iframe') as HTMLIFrameElement;
    const doc = frame.contentDocument!;
    const b = doc.querySelector('b')!; // <b>Q2</b>
    const range = doc.createRange();
    range.selectNode(b);
    const sel = frame.contentWindow!.getSelection()!;
    sel.removeAllRanges();
    sel.addRange(range);
  });
  await page.locator('#btn-copy').click();
  expect((await app.evaluate(({ clipboard }) => clipboard.readText())).trim()).toBe('Q2');
  expect(await app.evaluate(({ clipboard }) => clipboard.readHTML())).toMatch(/<b\b/i);
});

test('Nuevo: vuelve al estado inicial sin mensaje', async () => {
  await launch(join(FIXTURES, 'html-basic.msg'));
  await expect(page.locator('#subject')).toHaveText('Informe trimestral Q2');
  await page.locator('#btn-new').click();
  await expect(page.locator('#empty-state')).toBeVisible();
  await expect(page.locator('#header')).toBeHidden();
  // Los botones que requieren documento quedan deshabilitados.
  await expect(page.locator('#btn-save-as')).toBeDisabled();
  await expect(page.locator('#btn-export')).toBeDisabled();
});

test('vista de código fuente: resaltado y búsqueda propios', async () => {
  await launch(join(FIXTURES, 'sample.eml'));
  await expect(page.locator('#subject')).toHaveText('Correo EML de prueba');
  const winPromise = app.waitForEvent('window', { timeout: 15000 });
  await page.locator('#btn-source').click();
  const src = await winPromise;
  // Cabeceras del .eml visibles y con resaltado de clave.
  await expect(src.locator('#hdr .hk').first()).toBeVisible();
  await expect(src.locator('#hdr')).toContainText('MIME-Version');
  // Análisis de ruta: 2 saltos con demora calculada y chips de autenticación.
  await expect(src.locator('table tbody tr')).toHaveCount(2);
  await expect(src.locator('table tbody tr').nth(1).locator('td').last()).toHaveText('+40 s');
  await expect(src.locator('.chip.ok').first()).toContainText('SPF=pass');
  // Búsqueda interna con contador y marca activa.
  await src.locator('#q').fill('boundary');
  await expect(src.locator('#count')).toContainText('1/');
  await expect(src.locator('mark.act').first()).toBeVisible();
});

test('menú Ver → código fuente abre la ventana de source', async () => {
  await launch(join(FIXTURES, 'sample.eml'));
  await expect(page.locator('#subject')).toHaveText('Correo EML de prueba');
  const winPromise = app.waitForEvent('window', { timeout: 15000 });
  // La opción de menú envía la acción 'source' al renderer (igual que el menú real).
  await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0]?.webContents.send('menu-action', { type: 'source' })
  );
  const src = await winPromise;
  await expect(src.locator('#hdr')).toContainText('MIME-Version');
});

test('sin tráfico de red saliente durante apertura (NFR-03)', async () => {
  await launch(join(FIXTURES, 'hostile-script.msg'));
  await expect(page.locator('#subject')).toHaveText('XSS attempt');
  // La petición del tracker debe haberse cancelado en capa de sesión:
  // ninguna imagen del documento apunta a un host remoto.
  const remoteImgs = await page
    .frameLocator('#body-frame')
    .locator('img')
    .evaluateAll((imgs) => imgs.map((i) => (i as HTMLImageElement).src).filter((s) => /^https?:/.test(s)));
  expect(remoteImgs).toEqual([]);
});
