# Plan de pruebas — MSG Viewer

Listado de **todas las features actuales** con una prueba para cada una, a pasar
antes de publicar una versión. Cada feature indica:

- ✅ **Auto**: cubierta por una prueba automatizada (nombre del test).
- 🔍 **Manual**: pasos a verificar a mano (UI nativa, integración con el SO o
  fidelidad visual que no se automatiza).

## Cómo correr las pruebas automatizadas

```bash
npm run fixtures        # genera el corpus sintético (tests/fixtures/)
npm test                # unit (Vitest) — 44 pruebas
npm run build
npx playwright test     # E2E (Playwright) — 25 pruebas
npm run lint && npm run typecheck
```

Para las pruebas manuales: `npm run dev` y abrir los fixtures de
`tests/fixtures/` indicados en cada caso.

---

## 1. Apertura y formatos de entrada

| Feature | Prueba |
|---|---|
| Abrir `.msg` (HTML/RTF/texto) por argv | ✅ Auto · E2E *apertura por argv renderiza metadatos, cuerpo y adjuntos* |
| Abrir `.eml` (RFC 5322) | ✅ Auto · E2E *abre archivos .eml (RFC 5322)*; unit *eml-adapter* |
| Abrir `.emlx` (Apple Mail) | ✅ Auto · unit *abre archivos .emlx de Apple Mail* |
| Detección por contenido (extensión renombrada) | ✅ Auto · unit *un .msg renombrado a .eml se detecta por contenido* |
| Des-encapsular HTML desde RTF comprimido | ✅ Auto · unit *des-encapsula HTML desde RTF comprimido* |
| RTF puro → conversión aproximada | ✅ Auto · unit *convierte RTF puro de forma aproximada* |
| Texto plano envuelto en `<pre>` | ✅ Auto · unit *cae a texto plano envuelto en `<pre>`* |
| Cadenas ANSI (001E) con codepage no latino (sin mojibake) | ✅ Auto · unit *decodifica cadenas ANSI (001E) según PR_MESSAGE_CODEPAGE* |
| Cuerpo HTML binario decodificado por PR_INTERNET_CPID | ✅ Auto · cubierto vía `decodeHtmlBytes` (unit de adapter) |
| Mensajes anidados (.msg/.eml) en ventana propia | 🔍 Manual · abrir un correo con un `.msg` adjunto → clic en ↗ del chip → se abre ventana nueva |
| Abrir con doble clic / "Abrir con" del SO | 🔍 Manual · asociar tipos y abrir un `.msg` desde el gestor de archivos |
| Arrastrar archivo a la ventana (drag-in) | 🔍 Manual · arrastrar un `.msg` sobre la zona de bienvenida y sobre un correo abierto |

## 2. Visualización del cuerpo

| Feature | Prueba |
|---|---|
| Render del cuerpo en iframe sandbox | ✅ Auto · E2E *apertura por argv…* |
| Imágenes inline `cid:` → `data:` | ✅ Auto · E2E *imagen inline cid: renderizada como data: URI*; unit msg/eml |
| Zoom del cuerpo (solo el cuerpo, no la ventana) | ✅ Auto · E2E *zoom y modo oscuro afectan solo al cuerpo…* |
| Modo oscuro del cuerpo (accesibilidad WCAG 1.4.3) | ✅ Auto · E2E *zoom y modo oscuro…* + 🔍 Manual · abrir un correo con texto de colores y verificar legibilidad |
| Fidelidad visual del render (correos reales) | 🔍 Manual · abrir correos reales y comparar con Outlook |

## 3. Cabecera, metadatos y adjuntos

| Feature | Prueba |
|---|---|
| Metadatos (asunto, de, para, cc, fechas) | ✅ Auto · unit *parsea metadatos…* (msg y eml) |
| Limpieza del DN X.500 de Exchange → SMTP | ✅ Auto · unit *destinatarios de Exchange…* y *limpia el DN X.500…* |
| Copiar dirección con un clic / copiar todas | 🔍 Manual · clic en una dirección y en el botón ⧉ → portapapeles |
| Copiar metadatos (texto / JSON) | 🔍 Manual · botones de la barra → pegar y verificar |
| Chips de adjuntos (reales vs inline) | ✅ Auto · E2E *apertura por argv…* |
| Guardar un adjunto (integridad binaria) | ✅ Auto · E2E *guardar adjunto conserva integridad binaria* |
| Guardar todos los adjuntos | 🔍 Manual · "Guardar todos" → elegir carpeta |
| Abrir adjunto (temporal) | 🔍 Manual · clic en chip → Abrir |
| **Arrastrar adjunto hacia fuera (drag-out)** | ✅ Auto · E2E *arrastrar un adjunto fuera inicia el drag nativo…* + 🔍 Manual · arrastrar a Dolphin/Finder y a un correo nuevo |

## 4. Exportación, Guardar como e Impresión

| Feature | Prueba |
|---|---|
| Exportar PDF | ✅ Auto · E2E *exportar PDF produce un PDF válido* |
| Exportar EML | ✅ Auto · E2E *exportar EML…*; unit *eml* |
| Exportar PNG (archivo / portapapeles, diálogo destino) | ✅ Auto · E2E *exportar PNG…* + 🔍 Manual · opción "Copiar al portapapeles" |
| Exportar HTML | 🔍 Manual · exportar y abrir en navegador |
| Exportar TXT | ✅ Auto · unit *documentToText* (vía bundle) + 🔍 Manual |
| **Exportar Markdown** | ✅ Auto · E2E *exportar Markdown…*; unit *documentToMarkdown* |
| Exportar MHT (web autocontenida) | ✅ Auto · unit *exportMht…* |
| Exportar JSON | ✅ Auto · unit *documentToJson…* |
| Exportar ZIP (con adjuntos) | ✅ Auto · E2E *exportar ZIP…*; unit *exportZip…* |
| PNG demasiado alto → diálogo truncar | 🔍 Manual · exportar PNG de un correo muy largo |
| **Guardar como (mismos formatos que Exportar)** | ✅ Auto · E2E *Guardar como ofrece los formatos de exportación (Markdown)* + 🔍 Manual · verificar todas las extensiones del diálogo |
| Atajos de teclado de export (⇧P/E/G/H/T/D/M/J/Z) | 🔍 Manual · probar cada acelerador con un correo abierto |
| Imprimir (diálogo del sistema) | 🔍 Manual · Archivo → Imprimir |

## 5. Búsqueda

| Feature | Prueba |
|---|---|
| Buscar en el mensaje (Ctrl+F) con contador | ✅ Auto · E2E *búsqueda en el mensaje (Ctrl+F)…* |
| Desplazamiento a la coincidencia activa | ✅ Auto · E2E *búsqueda propia desplaza hasta la coincidencia activa* |

## 6. Seguridad, anti-phishing y privacidad

| Feature | Prueba |
|---|---|
| Sin ejecución de scripts del correo | ✅ Auto · E2E *correo hostil: sin ejecución de scripts…* |
| Sanitización del HTML (elimina on*, javascript:, script) | ✅ Auto · unit *elimina scripts, manejadores on* y javascript:* |
| Bloqueo de red saliente (NFR-03) | ✅ Auto · E2E *sin tráfico de red saliente…* |
| Imágenes remotas → placeholder | ✅ Auto · unit *sustituye imágenes remotas por placeholder* |
| URL real del enlace al pasar el cursor | 🔍 Manual · hover sobre un enlace → barra inferior |
| Advertencia antes de abrir enlace externo | ✅ Auto · E2E *clic en enlace: advertencia antes de salir…* |
| **Resaltar discrepancia texto-vs-href (phishing)** | ✅ Auto · E2E *resalta enlaces cuyo texto aparenta otro dominio* |
| Activar/desactivar el aviso de enlaces engañosos (diálogo) | ✅ Auto · E2E *toggle de enlaces engañosos con diálogo tipo Unlink* |
| Unlink (deshabilitar todos los enlaces) | 🔍 Manual · botón Unlink → confirmar → enlaces inertes |
| Firma presente (badge, no verificada) | 🔍 Manual · abrir un correo firmado |

## 7. Análisis técnico (código fuente forense)

| Feature | Prueba |
|---|---|
| Vista de código fuente (cabeceras + cuerpo) | ✅ Auto · E2E *vista de código fuente…* |
| Abrir code source desde el menú Ver | ✅ Auto · E2E *menú Ver → código fuente abre la ventana de source* |
| Ruta del mensaje (Received cronológico + demora) | ✅ Auto · unit *ordena cronológicamente y calcula la demora* |
| SPF/DKIM/DMARC | ✅ Auto · unit *extrae spf/dkim/dmarc…* |
| Resaltado/búsqueda en la vista de fuente | ✅ Auto · E2E *vista de código fuente: resaltado y búsqueda…* |
| Decodificador base64 / quoted-printable | 🔍 Manual · seleccionar texto codificado en la vista de fuente |
| Propiedades MAPI crudas | 🔍 Manual · abrir un `.msg` y revisar el panel |
| Diff de sanitización | 🔍 Manual · abrir `hostile-script.msg` y ver lo eliminado |

## 8. Interfaz, menús, zoom y accesibilidad

| Feature | Prueba |
|---|---|
| Estado de bienvenida (vacío) | ✅ Auto · E2E *arranque sin archivo muestra el estado de bienvenida* |
| "Nuevo" vuelve al estado inicial | ✅ Auto · E2E *Nuevo: vuelve al estado inicial sin mensaje* |
| Botón Exportar con menú de 9 formatos | ✅ Auto · E2E export (varios) |
| Botón Copiar (selección con formato / todo) | ✅ Auto · E2E *…copiar vuelca su texto* + 🔍 Manual · seleccionar e copiar imagen |
| Menú Ver con separador + código fuente | ✅ Auto · E2E *menú Ver → código fuente…* |
| Recordar documento tras recargar | ✅ Auto · E2E *Ver→Recargar conserva el documento* |
| i18n (es/en según locale) | 🔍 Manual · arrancar con `LANG=en_US.UTF-8` |
| Diálogo "Acerca de" in-app (+ easter egg) | ✅ Auto · E2E *Acerca de: diálogo in-app con la versión* + 🔍 Manual · easter egg (3 clics en el icono) |

## 9. Integración con el sistema operativo

| Feature | Prueba |
|---|---|
| Asociar tipos de archivo (diálogo in-app) | ✅ Auto · E2E *Asociar tipos: diálogo in-app con casillas* + 🔍 Manual · confirmar y comprobar la asociación real (xdg) |
| Archivos recientes | 🔍 Manual · abrir varios y revisar el submenú Recientes |
| Abrir enlace externo en el navegador | 🔍 Manual · confirmar advertencia y verificar que abre |
| Mostrar en carpeta (tras guardar/exportar) | 🔍 Manual · botón del toast |
| Instancia única (segundo arranque entrega argv) | 🔍 Manual · abrir un 2.º archivo con la app ya abierta |

## 10. Robustez y manejo de errores

| Feature | Prueba |
|---|---|
| Archivo corrupto → error descriptivo, app operativa | ✅ Auto · E2E *archivo corrupto…*; unit varios *not-cfbf/truncated* |
| Mensaje cifrado S/MIME → informa sin crash | ✅ Auto · E2E *mensaje cifrado S/MIME…*; unit *cifrado S/MIME → encrypted* |
| Clase no soportada (p. ej. calendario) | ✅ Auto · unit *clase no soportada → unsupported-class* |
| Fuzzing: mutaciones nunca lanzan | ✅ Auto · unit *fuzzing ligero…* y *archivo truncado no crashea* |

---

## Checklist mínima antes de publicar

- [ ] `npm test` (44) y `npx playwright test` (25) en verde.
- [ ] `npm run lint` y `npm run typecheck` sin errores.
- [ ] Repaso manual de drag-out a Dolphin/Finder y a un correo nuevo.
- [ ] Repaso manual de impresión y de "Guardar como" con cada formato.
- [ ] Abrir 2-3 correos **reales** y revisar fidelidad de render, modo oscuro y
      detección de enlaces engañosos.
- [ ] `build:linux` (y `build:mac` si aplica) generan artefactos abribles.
- [ ] Antes del push: `git log -p main | grep -iE "falabella|rut"` vacío.
