# MSG Viewer

Visor de escritorio ligero y multiplataforma (**Linux y macOS**) para archivos
`.msg` de Microsoft Outlook. Funciona **100% offline**: el contenido del correo
nunca abandona tu equipo.

> En macOS y Linux no hay forma nativa de abrir un `.msg` recibido desde un
> entorno corporativo Windows/Outlook sin instalar Outlook o subir el archivo
> a un servicio web de terceros. MSG Viewer cubre ese vacío.

## Características

### 📬 Visualización

| Característica | Detalle |
|---|---|
| **Formatos de entrada** | `.msg` (Outlook), `.eml` (RFC 5322) y `.emlx` (Apple Mail), con **detección por contenido** (una extensión renombrada se abre igual) |
| **Metadatos completos** | Asunto, remitente, destinatarios (Para/CC/CCO), fechas de envío y recepción |
| **Cuerpo en cascada** | HTML nativo → RTF des-encapsulado (recupera el HTML original de Outlook) → RTF aproximado → texto plano |
| **Imágenes incrustadas** | Las `cid:` se renderizan en su posición; las remotas se bloquean (placeholder) y solo se cargan con un clic, tras un aviso de rastreo |
| **Mensajes anidados** | Un `.msg`/`.eml` adjunto se abre en **ventana propia** para comparar lado a lado |
| **Direcciones de Exchange** | Resuelve el SMTP real en vez del DN X.500 interno (`/o=ExchangeLabs/...`) |
| **Idioma y tema** | Español/inglés según el sistema · claro/oscuro automático |

### 🔒 Seguridad y privacidad

| Característica | Detalle |
|---|---|
| **Contenido hostil** | El cuerpo se sanitiza (DOMPurify) y se aísla en un iframe sandbox sin scripts + CSP restrictiva |
| **Sin red** | Cero tráfico saliente automático: bloqueo en capa de sesión (verificable con `tcpdump`), cero telemetría. La única excepción es la descarga de una imagen remota que tú pidas explícitamente |
| **Imágenes remotas** | Bloqueadas por defecto. Al pulsar el placeholder, un aviso explica el rastreo (píxel de seguimiento: IP, fecha/hora de lectura) antes de descargarla |
| **Anti-phishing** | La URL real de cada enlace se ve al pasar el cursor; el clic exige confirmar antes de salir al navegador, y si el enlace es engañoso la propia advertencia lo explica |
| **Enlaces engañosos** | Resaltado opcional de los enlaces cuyo texto aparenta un dominio distinto al destino real (`<a>paypal.com</a>` → `evil.com`) |
| **Unlink** | Un botón deja todos los enlaces inertes (tachados) para inspeccionar correos sospechosos sin riesgo |
| **Adjuntos bajo control** | Solo se escriben a disco por acción explícita; los temporales de "Abrir" se purgan al salir |

### 🛠️ Acciones y exportación

| Característica | Detalle |
|---|---|
| **Barra de herramientas** | Iconos [Lucide](https://lucide.dev): Nuevo · Abrir · Guardar como · Copiar · Buscar · zoom del cuerpo · oscurecer el cuerpo · Unlink · resaltar enlaces engañosos · código fuente · Exportar · Acerca de (Imprimir sigue en el menú, Ctrl+P) |
| **Exportar** (9 formatos) | **PDF** (A4/Carta), **EML**, **PNG** (+copiar al portapapeles), **HTML**, **TXT**, **Markdown**, **MHT** (web con imágenes embebidas), **JSON** (pipelines) y **ZIP** (correo + metadata + cuerpos + adjuntos) |
| **Guardar como…** | Un diálogo con **los mismos formatos que Exportar** (+ el original); el formato se decide por la extensión elegida (Ctrl+S) |
| **Copiar con formato** | Copia la selección (o todo el cuerpo) conservando texto enriquecido e imágenes |
| **Adjuntos arrastrables** | Arrastra un adjunto fuera de la app para soltarlo en el gestor de archivos o en un correo nuevo |
| **Accesibilidad** | Zoom del cuerpo y modo de alto contraste (fondo oscuro, texto claro) independientes de la ventana |
| **Imprimir** | Diálogo del sistema sobre el mensaje y su cabecera (Ctrl+P) |
| **Búsqueda** | En el cuerpo (Ctrl+F): resaltado, contador y desplazamiento a la coincidencia |
| **Adjuntos** | Clic para Abrir con la app predeterminada o Guardar; "Guardar todos" con integridad verificada |
| **Copiar** | Direcciones con un clic (o todas por campo) · metadatos como texto o JSON |
| **Archivos recientes** | Últimos 10, persistentes, en el menú Archivo |
| **Asociación con el SO** | Diálogo para elegir qué tipos (.msg/.eml/.emlx) abre la app (Linux vía xdg-mime; macOS guía de Finder) |

### 🔬 Análisis técnico (vista de código fuente)

| Característica | Detalle |
|---|---|
| **Resaltado de sintaxis** | Cabeceras, etiquetas/atributos HTML y bloques base64, con búsqueda, copiar, imprimir y exportar |
| **Ruta del mensaje** | Cadena `Received` cronológica con la **demora entre saltos** y resultados **SPF/DKIM/DMARC** |
| **Decodificador** | Selecciona base64 o quoted-printable y lo descodifica en el sitio |
| **Propiedades MAPI crudas** | Tabla completa de PidTag del `.msg` (forense) |
| **Diff de sanitización** | Lista exacta de scripts/manejadores que el correo traía y se eliminaron |

## Instalación

### Instalación rápida en Linux (una línea)

Descarga el último AppImage, lo deja en `~/.local/bin` y lo añade al menú de aplicaciones:

```bash
bash -c "$(curl -fsSL https://raw.githubusercontent.com/oscarhenriquezg/msgview/main/scripts/install.sh)"
```

> Los AppImage requieren **FUSE2** (`libfuse2`). Si al arrancar ves un error de
> FUSE, instálalo (`sudo apt install libfuse2` / `sudo dnf install fuse fuse-libs`)
> o ejecuta con `~/.local/bin/MSGViewer.AppImage --appimage-extract-and-run`.

### Descarga manual

Descarga desde [Releases](https://github.com/oscarhenriquezg/msgview/releases):

**Linux** — AppImage (recomendado, cualquier distro con glibc ≥ 2.35), `.deb` o `.rpm`:

```bash
chmod +x "MSG Viewer-x.y.z-x86_64.AppImage"
./"MSG Viewer-x.y.z-x86_64.AppImage" correo.msg
```

**macOS** — monta el `.dmg` y arrastra la app a Aplicaciones (macOS 12+, binario universal).

> **App sin firmar:** MSG Viewer es gratuita (GPL) y no está firmada ni
> notarizada por Apple (el Developer Program cuesta 99 USD/año). macOS la
> bloqueará la primera vez con un aviso de desarrollador no identificado. Para
> abrirla:
>
> - **Opción A:** clic derecho sobre la app → **Abrir** → confirma **Abrir** en
>   el diálogo. Solo hace falta la primera vez.
> - **Opción B (Terminal):** quita el atributo de cuarentena y ábrela normal:
>
>   ```bash
>   xattr -dr com.apple.quarantine "/Applications/MSG Viewer.app"
>   ```
>
> Esto no compromete la seguridad: el código es abierto y la app funciona 100%
> offline. La firma se añadirá si en el futuro se costea la cuenta de Apple.

## Limitaciones conocidas (por diseño)

| | |
|---|---|
| RTF→HTML aproximado | Si el mensaje solo trae RTF puro (sin HTML nativo ni encapsulado), la conversión es una aproximación. |
| EML reconstruido | El EML se genera desde las propiedades MAPI; no es byte-equivalente al mensaje SMTP original. |
| Imágenes remotas | Bloqueadas por defecto (placeholder); cargables con un clic tras un aviso de rastreo. Las incrustadas sí se muestran. |
| PNG ≤ 20.000 px | Para correos más largos, la app ofrece truncar o sugiere PDF. |
| Tipos no soportados | Citas, contactos y tareas se informan como no soportados; S/MIME cifrado no puede mostrarse; las firmas se indican pero no se verifican. |

## Desarrollo

```bash
npm install
npm run fixtures      # genera el corpus de .msg de prueba (sintético)
npm run dev           # arranque con recarga automática
npm test              # unit tests (parser, EML, corpus adversarial)
npm run build && npx playwright test   # E2E sobre la app construida
npm run build:linux   # AppImage/deb/rpm en release/
npm run build:mac     # dmg/zip (requiere macOS)
```

Para probar con correos reales, copia archivos `.msg` a `tests/fixtures/real/`
(directorio ignorado por git): la suite los recoge automáticamente y
`npx vite-node scripts/report-real.ts` genera un informe de parseo.

### Arquitectura

Electron + TypeScript. El parsing (`@kenjiuno/msgreader` tras un adapter
propio) ocurre en un worker thread del proceso main; el renderer recibe un
documento serializado con HTML ya sanitizado y muestra el cuerpo en un iframe
sandbox sin ejecución de scripts. El bloqueo de red, los diálogos nativos y la
escritura a disco viven exclusivamente en main. Especificación completa en
[SRS-visor-msg-v0.2.md](SRS-visor-msg-v0.2.md).

## Licencia

© 2026 Oscar Henríquez. Publicado bajo la **GNU General Public License v3.0
(o posterior)**. El texto completo está en [LICENSE.md](LICENSE.md).

Política de seguridad y reporte de vulnerabilidades: [SECURITY.md](SECURITY.md).

### Software de terceros

MSG Viewer usa las siguientes bibliotecas de código abierto. Todas sus
licencias son compatibles con la GPL-3.0. Cada una conserva su licencia y sus
derechos de autor originales.

| Dependencia | Uso | Licencia |
| --- | --- | --- |
| [Electron](https://github.com/electron/electron) | Entorno de ejecución de escritorio | MIT |
| [@kenjiuno/msgreader](https://github.com/HiraokaHyperTools/msgreader) | Lectura de archivos `.msg` (CFBF/MAPI) | Apache-2.0 |
| [@kenjiuno/decompressrtf](https://github.com/HiraokaHyperTools/decompressRTF) | Descompresión de RTF comprimido | BSD-2-Clause |
| [rtf-stream-parser](https://github.com/mazira/rtf-stream-parser) | Des-encapsulación de HTML/RTF | MIT |
| [mailparser](https://github.com/nodemailer/mailparser) | Lectura de archivos `.eml`/`.emlx` (MIME) | MIT |
| [DOMPurify](https://github.com/cure53/DOMPurify) | Sanitización del HTML del correo | MPL-2.0 OR Apache-2.0 |
| [jsdom](https://github.com/jsdom/jsdom) | DOM para DOMPurify en el proceso main | MIT |
| [iconv-lite](https://github.com/ashtuchkin/iconv-lite) | Decodificación de juegos de caracteres heredados | MIT |
| [archiver](https://github.com/archiverjs/node-archiver) | Generación de exportaciones ZIP | MIT |
| [Lucide](https://lucide.dev) (`lucide-static`) | Iconos de la interfaz (inlineados en el build) | ISC |

> El listado completo de licencias de la cadena de dependencias —incluidas las
> de desarrollo— puede generarse con `npx license-checker --production`.
