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
| **Imágenes incrustadas** | Las `cid:` se renderizan en su posición; las remotas se bloquean (placeholder) |
| **Mensajes anidados** | Un `.msg`/`.eml` adjunto se abre en **ventana propia** para comparar lado a lado |
| **Direcciones de Exchange** | Resuelve el SMTP real en vez del DN X.500 interno (`/o=ExchangeLabs/...`) |
| **Idioma y tema** | Español/inglés según el sistema · claro/oscuro automático |

### 🔒 Seguridad y privacidad

| Característica | Detalle |
|---|---|
| **Contenido hostil** | El cuerpo se sanitiza (DOMPurify) y se aísla en un iframe sandbox sin scripts + CSP restrictiva |
| **Sin red** | Bloqueo total de tráfico saliente en capa de sesión (verificable con `tcpdump`). Cero telemetría |
| **Anti-phishing** | La URL real de cada enlace se ve al pasar el cursor; el clic exige confirmar antes de salir al navegador |
| **Unlink** | Un botón deja todos los enlaces inertes (tachados) para inspeccionar correos sospechosos sin riesgo |
| **Adjuntos bajo control** | Solo se escriben a disco por acción explícita; los temporales de "Abrir" se purgan al salir |

### 🛠️ Acciones y exportación

| Característica | Detalle |
|---|---|
| **Barra de herramientas** | Iconos [Lucide](https://lucide.dev): Nuevo · Abrir · Guardar como · Imprimir · Buscar · PDF/EML/PNG · zoom · Unlink · metadatos · código fuente · Acerca de |
| **Exportar** (8 formatos) | **PDF** (A4/Carta), **EML**, **PNG** (+copiar al portapapeles), **HTML**, **TXT**, **MHT** (web con imágenes embebidas), **JSON** (pipelines) y **ZIP** (correo + metadata + cuerpos + adjuntos) |
| **Guardar como…** | Un diálogo, formato según la extensión elegida (Ctrl+S) |
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

Descarga desde [Releases](https://github.com/oscarhenriquezg/msgview/releases):

**Linux** — AppImage (recomendado, cualquier distro con glibc ≥ 2.35), `.deb` o `.rpm`:

```bash
chmod +x "MSG Viewer-x.y.z-x86_64.AppImage"
./"MSG Viewer-x.y.z-x86_64.AppImage" correo.msg
```

**macOS** — monta el `.dmg` y arrastra la app a Aplicaciones (macOS 12+, binario universal).

## Limitaciones conocidas (por diseño)

| | |
|---|---|
| RTF→HTML aproximado | Si el mensaje solo trae RTF puro (sin HTML nativo ni encapsulado), la conversión es una aproximación. |
| EML reconstruido | El EML se genera desde las propiedades MAPI; no es byte-equivalente al mensaje SMTP original. |
| Imágenes remotas | Bloqueadas siempre (placeholder); las incrustadas sí se muestran. |
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

MIT © 2026 Oscar Henríquez
