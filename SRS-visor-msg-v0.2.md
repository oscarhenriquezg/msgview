# Especificación de Requisitos de Software (SRS)

## Proyecto: Visor de Archivos `.msg` Multiplataforma

| Campo | Valor |
|---|---|
| Versión | 0.2 (borrador) |
| Fecha | 2026-06-12 |
| Estado | En revisión |

---

## 1. Propósito y Descripción General

El software es una aplicación de escritorio ligera y multiplataforma (macOS y Linux) que permite **abrir, analizar, renderizar y visualizar** archivos de correo electrónico en formato propietario de Microsoft Outlook (`.msg`), y **exportarlos** a formatos estándar.

El problema que resuelve: en macOS y Linux no existe una forma nativa de abrir un `.msg` recibido (por ejemplo, reenviado como adjunto desde un entorno corporativo Windows/Outlook) sin instalar Outlook o subir el archivo a un servicio web de terceros. Esta aplicación cubre ese vacío operando **100% offline**, sin que el contenido del correo abandone el equipo del usuario.

### 1.1 Definiciones y Acrónimos

| Término | Definición |
|---|---|
| `.msg` | Formato propietario de Microsoft para un mensaje individual de Outlook, basado en el contenedor CFBF |
| CFBF | Compound File Binary Format (OLE2), estructura de almacenamiento interno del `.msg` |
| MAPI | Messaging Application Programming Interface; modelo de propiedades que el `.msg` serializa |
| RTF comprimido | Codificación LZFu usada por Outlook para el cuerpo en formato RTF (`PidTagRtfCompressed`) |
| EML | Formato de correo estándar en texto plano (RFC 5322 / MIME) |
| Sandboxing | Aislamiento del contenido del correo respecto de la aplicación y del sistema |

### 1.2 Alcance

**Dentro del alcance (v1.0):**
- Visualización de archivos `.msg` de tipo mensaje de correo (IPM.Note), incluyendo metadatos, cuerpo y adjuntos.
- Exportación a PDF, EML y PNG.
- Extracción de adjuntos a disco.
- Integración con el sistema operativo como visor asociado a la extensión `.msg`.

**Fuera del alcance (v1.0):**
- Edición o composición de correos.
- Otros tipos de objeto MAPI (citas de calendario, contactos, tareas) — se mostrarán con un mensaje de "tipo no soportado" indicando la clase del mensaje.
- Archivos `.pst` / `.ost` (almacenes de buzón completos).
- Firmas digitales S/MIME: no se validarán criptográficamente; un correo firmado se mostrará como contenido, con un indicador de "firma presente, no verificada".
- Correos cifrados (S/MIME encriptado): se informará al usuario que el contenido está cifrado y no puede mostrarse.
- Versiones para Windows (puede abrirse nativamente con Outlook; queda como posible extensión futura sin costo arquitectónico si la pila lo permite).

---

## 2. Objetivos Principales

* **OBJ-01 — Soporte multiplataforma:** ejecución nativa en macOS y Linux con experiencia visual idéntica entre plataformas.
* **OBJ-02 — Operación 100% offline:** parsing, renderizado y exportación completamente locales, sin dependencias de red ni servicios en la nube.
* **OBJ-03 — Alta fidelidad visual:** renderizado del cuerpo del mensaje lo más cercano posible a cómo lo mostraría Outlook, dentro de las limitaciones documentadas en §2.1.
* **OBJ-04 — Gestión de adjuntos:** listar, identificar y extraer a disco los adjuntos incrustados.
* **OBJ-05 — Exportación a formatos estándar:** PDF, EML y PNG.
* **OBJ-06 — Aplicación ligera:** arranque rápido, consumo de recursos acotado y artefacto de instalación razonable (ver NFRs).

### 2.1 Supuestos y Limitaciones Conocidas (declaradas por diseño)

* **L-01 — Conversión RTF→HTML es lossy:** cuando el `.msg` solo contiene cuerpo RTF (sin HTML nativo), la conversión a HTML es una aproximación. La fidelidad "pixel-perfect" solo se garantiza cuando existe cuerpo HTML nativo (`PidTagHtml`).
* **L-02 — Exportación EML es una reconstrucción:** el EML generado se reconstruye a partir de las propiedades MAPI; **no** es byte-equivalente al mensaje original transmitido por SMTP. Cabeceras de transporte no presentes en el `.msg` no pueden recuperarse.
* **L-03 — Imágenes remotas bloqueadas:** por diseño offline y de privacidad, las imágenes referenciadas por URL externa no se cargan; se muestran como placeholder. Las imágenes incrustadas (inline, referenciadas por `cid:`) sí se renderizan desde los adjuntos del propio archivo.
* **L-04 — PNG de correos extensos:** la captura PNG de un correo muy largo está acotada (ver FR-13) para evitar imágenes que los visores comunes no puedan abrir.

---

## 3. Objetivos Secundarios (Deseables, no bloqueantes para v1.0)

* **OBJ-S1 — Metadatos extendidos:** visualización de indicadores nativos de Outlook (prioridad alta/baja, banderas de seguimiento, confirmaciones de lectura) si la librería de parsing expone dichos atributos MAPI sin ingeniería inversa adicional.
* **OBJ-S2 — `.msg` anidados:** si un adjunto es a su vez un `.msg` (mensaje incrustado), permitir abrirlo en la misma aplicación.
* **OBJ-S3 — Vista de código fuente:** pestaña o modo opcional para inspeccionar el HTML del cuerpo y las propiedades MAPI crudas (orientado a usuarios técnicos / forense ligero).
* **OBJ-S4 — Apertura múltiple:** soporte de varios archivos simultáneos (ver FR-03 para el comportamiento por defecto).

---

## 4. Requisitos Funcionales

### 4.1 Apertura y ciclo de vida

* **FR-01 — Integración con el SO:** la aplicación debe registrarse como manejador (predeterminado o disponible) para la extensión `.msg` / MIME type `application/vnd.ms-outlook`:
  * Linux: archivo `.desktop` con `MimeType=application/vnd.ms-outlook;` y registro vía `xdg-mime`.
  * macOS: declaración `CFBundleDocumentTypes` en `Info.plist` y manejo del evento `open-file`.
* **FR-02 — Vías de carga:** el archivo debe poder abrirse por (a) argumento de línea de comandos / doble clic desde el explorador de archivos, (b) arrastrar y soltar sobre la ventana, (c) diálogo "Abrir archivo" desde la propia aplicación.
* **FR-03 — Instancia única:** si el usuario abre un nuevo `.msg` con la aplicación ya en ejecución, el contenido de la ventana activa se reemplaza por el nuevo mensaje (no se abren procesos adicionales).
* **FR-04 — Estado vacío:** al iniciarse sin archivo, la aplicación muestra una pantalla de bienvenida con zona de drag & drop y botón "Abrir archivo".
* **FR-05 — Manejo de errores de carga:** ante un archivo corrupto, truncado, cifrado o de tipo no soportado, la aplicación muestra un mensaje de error descriptivo (qué falló y, si es identificable, por qué) y permanece operativa. Nunca debe producirse un crash ni una ventana en blanco.

### 4.2 Visualización

* **FR-06 — Metadatos básicos:** panel de cabecera con: Asunto, Remitente (De), Destinatarios (Para, CC; BCC si está presente en las propiedades), Fecha de envío y de recepción.
* **FR-07 — Resolución del cuerpo:** el cuerpo se resuelve con la siguiente prioridad: (1) HTML nativo (`PidTagHtml`) si existe; (2) RTF descomprimido y convertido a HTML; (3) texto plano envuelto en HTML mínimo (`<pre>` con tipografía monoespaciada). El usuario no necesita conocer cuál vía se usó, pero la vista de código fuente (OBJ-S3) la indicará.
* **FR-08 — Renderizado seguro (sandboxing):** el cuerpo del correo se trata siempre como **contenido hostil** y se inyecta en un `iframe` aislado con:
  * Ejecución de JavaScript bloqueada (atributo `sandbox` sin `allow-scripts`).
  * CSP restrictiva que prohíbe scripts, formularios y recursos remotos.
  * Sanitización previa del HTML (eliminación de `<script>`, manejadores `on*`, `javascript:` URIs).
  * Aislamiento de estilos: el CSS del correo no debe contaminar la UI de la aplicación ni viceversa.
* **FR-09 — Imágenes inline:** las imágenes incrustadas referenciadas por `cid:` se resuelven desde los adjuntos del `.msg` y se renderizan en su posición. Las imágenes remotas se reemplazan por un placeholder (ver L-03).
* **FR-10 — Panel de adjuntos:** lista de adjuntos detectados mostrando nombre de archivo, extensión/tipo e tamaño. Cada adjunto tiene un control para guardarlo en disco mediante diálogo nativo de "Guardar como". Acción adicional "Guardar todos" en una carpeta elegida por el usuario. Los adjuntos inline usados solo para renderizado (imágenes `cid:`) se distinguen visualmente o se agrupan aparte de los adjuntos "reales".

### 4.3 Exportación

Las tres exportaciones siguen el mismo patrón de interacción: botón en la barra de acciones → diálogo nativo "Guardar como" → generación directa del archivo, sin pasar por diálogos de impresión del sistema (cuyo comportamiento es inconsistente entre entornos de escritorio Linux).

* **FR-11 — Exportar a PDF:** generación de un PDF del mensaje completo (cabecera de metadatos + cuerpo renderizado), paginado en tamaño A4/Carta según configuración regional, mediante el motor de impresión del runtime (sin diálogo de impresión).
* **FR-12 — Exportar a EML:** reconstrucción del mensaje en formato MIME multiparte (RFC 5322): mapeo de propiedades MAPI a cabeceras estándar (`From`, `To`, `Cc`, `Subject`, `Date`, `Message-ID` si existe), cuerpo en `multipart/alternative` (texto + HTML cuando ambos existan) y adjuntos como partes `base64`. La limitación L-02 debe constar en la documentación de usuario.
* **FR-13 — Exportar a PNG:** captura del renderizado completo del mensaje (alto total del contenido, no solo el viewport), con límite de altura de 20.000 px; si el contenido lo excede, se advierte al usuario y se ofrece exportar truncado o cancelar (sugiriendo PDF como alternativa para correos largos).

---

## 5. Diseño de Interfaz y Experiencia de Usuario (UI/UX)

* **UI-01 — Distribución clásica (top-down):** ventana dividida en dos áreas: panel superior estático (cabecera) y área de visualización (cuerpo) que ocupa el espacio restante.
* **UI-02 — Panel de cabecera:**
  * **Bloque de metadatos:** Asunto (destacado), Remitente, Destinatarios y Fecha.
  * **Bloque de adjuntos:** fila horizontal bajo los metadatos con "chips" por adjunto (icono según tipo, nombre, tamaño) y acción de descarga; colapsable si no hay adjuntos.
  * **Barra de acciones:** botones de exportación (PDF, EML, PNG) y "Abrir archivo" en la esquina superior derecha.
* **UI-03 — Área de visualización:** `iframe` del cuerpo con scroll vertical independiente del panel de cabecera.
* **UI-04 — Tema claro/oscuro:** detección automática del tema del sistema (`prefers-color-scheme`) aplicada a la UI de la aplicación. El cuerpo del correo se renderiza siempre sobre fondo claro por defecto (los correos HTML asumen fondo blanco); opcionalmente, un toggle de "modo oscuro del contenido" con inversión inteligente queda como mejora futura.
* **UI-05 — Idioma:** interfaz en español e inglés (detección por locale del sistema), con arquitectura de cadenas externalizadas (i18n) para añadir idiomas sin tocar código.
* **UI-06 — Retroalimentación de operaciones:** las exportaciones y el guardado de adjuntos muestran confirmación no intrusiva (toast) con acceso directo "Mostrar en carpeta".

---

## 6. Requisitos No Funcionales

* **NFR-01 — Rendimiento de carga:** apertura y renderizado completo de un `.msg` de hasta 25 MB en menos de 2 segundos en hardware de referencia (CPU x86_64 de 4 núcleos, 8 GB RAM, SSD). Archivos de hasta 150 MB deben abrir en menos de 10 segundos **sin congelar la UI** (parsing fuera del hilo de interfaz).
* **NFR-02 — Consumo de recursos:** huella de memoria en reposo (archivo cargado, sin interacción) inferior a 400 MB. Sin procesos residentes tras cerrar la aplicación.
* **NFR-03 — Seguridad y aislamiento:**
  * Prohibición total de tráfico de red saliente en tiempo de ejecución, aplicada en dos capas: CSP en el contenido y cancelación de toda petición no-`file://`/`data:` a nivel de sesión del runtime. Verificable por auditoría (la aplicación no abre sockets externos).
  * El HTML del correo se trata siempre como entrada no confiable (ver FR-08).
  * Separación de privilegios: la lógica con acceso al sistema de archivos vive en el proceso principal; la UI no tiene acceso directo a APIs del sistema (context isolation, sin integración de Node en el renderer).
  * Los adjuntos se escriben a disco únicamente por acción explícita del usuario; nunca se extraen automáticamente a directorios temporales persistentes.
* **NFR-04 — Privacidad:** cero telemetría, cero analítica, cero comprobación automática de actualizaciones contra servicios remotos. Ningún dato del correo abandona el equipo.
* **NFR-05 — Portabilidad:**
  * macOS 12 (Monterey) o superior; x86_64 y arm64 (Apple Silicon), como binario universal o builds separadas.
  * Linux: distribuciones con glibc ≥ 2.35; X11 y Wayland. Distribución primaria vía **AppImage** (agnóstica de distro); paquetes `.deb` y `.rpm` como secundarios.
* **NFR-06 — Tamaño del artefacto:** el instalable no debe superar 150 MB por plataforma.
* **NFR-07 — Robustez:** ningún archivo de entrada (malformado, truncado, no-CFBF, extensión renombrada) debe provocar crash. Suite de tests con corpus de archivos válidos, corruptos y adversariales.
* **NFR-08 — Fidelidad de renderizado:** el motor HTML debe ser un engine de navegador moderno e **idéntico en ambas plataformas**, capaz de renderizar el HTML generado por Outlook/Word (tablas anidadas, estilos MSO inline, VML degradado con gracia).
* **NFR-09 — Mantenibilidad:** código bajo control de versiones con pipeline CI que ejecute build multiplataforma, tests unitarios del parser y linting en cada commit. La librería de parsing se encapsula tras una interfaz propia (patrón adapter) para poder reemplazarla sin reescribir la UI.
* **NFR-10 — Accesibilidad básica:** navegación por teclado en barra de acciones y panel de adjuntos; atajos para abrir (Ctrl/Cmd+O) y exportar; contraste WCAG AA en ambos temas.
* **NFR-11 — Arranque en frío:** tiempo desde doble clic en un `.msg` hasta contenido visible inferior a 3 segundos en el hardware de referencia (incluye arranque de la aplicación).

---

## 7. Arquitectura y Pila Tecnológica Propuesta

### 7.1 Decisión de framework: Electron

Se propone **Electron** como framework base. Justificación frente a la alternativa evaluada (Tauri 2):

| Criterio | Electron | Tauri 2 |
|---|---|---|
| Ecosistema de parsing `.msg` | Maduro en JS (`@kenjiuno/msgreader`, parser CFBF puro) | Crates Rust inmaduras/incompletas para MSG |
| Exportación PDF | Nativa vía `webContents.printToPDF()` | Sin equivalente directo; depende del diálogo de impresión del webview |
| Captura PNG del render | Nativa vía `webContents.capturePage()` | Soluciones ad-hoc (html2canvas) con pérdida de fidelidad |
| Consistencia de renderizado (NFR-08) | Chromium idéntico en macOS y Linux | WebKitGTK en Linux vs. WKWebView en macOS (renderizado divergente) |
| Tamaño del binario | ~85–120 MB | ~10 MB |

El único punto a favor de Tauri (tamaño) queda cubierto por NFR-06 (≤150 MB). La divergencia de motores de renderizado en Tauri compromete directamente OBJ-01 y OBJ-03 (experiencia visual idéntica y alta fidelidad), lo que lo descarta para este proyecto.

### 7.2 Componentes y librerías

| Componente | Selección | Notas |
|---|---|---|
| Runtime | Electron (LTS vigente) + TypeScript | |
| Parsing `.msg` | `@kenjiuno/msgreader` | Parser CFBF puro JS, sin dependencias nativas; expone metadatos, cuerpos, adjuntos y propiedades MAPI extendidas (cubre OBJ-S1) |
| RTF comprimido | `@kenjiuno/decompressrtf` + conversor RTF→HTML | Solo cuando no existe `PidTagHtml` (ver FR-07, L-01) |
| Sanitización HTML | `DOMPurify` | Capa adicional al sandboxing (defensa en profundidad) |
| Generación EML | Ensamblado MIME con `emailjs-mime-builder` o construcción manual RFC 5322/2045 | Mapeo MAPI → cabeceras estándar |
| Empaquetado | `electron-builder` | Targets: `dmg`/`zip` (macOS, con firma y notarización), `AppImage`/`deb`/`rpm` (Linux) |
| i18n | Cadenas externalizadas (JSON por locale) | UI-05 |
| Tests | Vitest (parser, mapeo EML) + Playwright (E2E sobre la app empaquetada) | NFR-07, NFR-09 |

### 7.3 Arquitectura de procesos

```
┌──────────────────────────────────────────────────────────┐
│ Main Process (Node.js)                                   │
│  - Single instance lock (app.requestSingleInstanceLock)  │
│  - Recepción de ruta: argv (Linux) / open-file (macOS)   │
│  - Lectura de archivo + parsing MSG en worker thread     │
│  - Diálogos nativos (guardar adjunto, exportar)          │
│  - Exportación: printToPDF / capturePage / builder EML   │
│  - Bloqueo de red: webRequest.onBeforeRequest            │
└──────────────────────┬───────────────────────────────────┘
                       │ IPC tipado (contextBridge/preload)
┌──────────────────────┴───────────────────────────────────┐
│ Renderer Process (UI de la aplicación)                   │
│  - contextIsolation: true · nodeIntegration: false       │
│  - Cabecera: metadatos + adjuntos + barra de acciones    │
│  - Tema light/dark vía prefers-color-scheme              │
│      ┌────────────────────────────────────────┐          │
│      │ <iframe sandbox> (contenido hostil)    │          │
│      │  - sandbox="" (sin allow-scripts)      │          │
│      │  - CSP <meta>: default-src 'none' ...  │          │
│      │  - srcdoc con HTML sanitizado          │          │
│      │  - imágenes cid: como data: URIs       │          │
│      └────────────────────────────────────────┘          │
└──────────────────────────────────────────────────────────┘
```

Decisiones clave:

* **El parsing ocurre en el proceso main (en un worker thread), nunca en el renderer.** El renderer recibe un objeto serializado: metadatos, HTML ya sanitizado y la lista de adjuntos (solo nombre/tipo/tamaño). Los bytes de los adjuntos permanecen en main y se escriben a disco bajo demanda, evitando transferir blobs grandes por IPC. Excepción: imágenes inline `cid:`, que se entregan como `data:` URIs incrustadas en el HTML.
* **Red bloqueada en dos capas:** CSP dentro del iframe + `session.webRequest.onBeforeRequest` cancelando todo lo que no sea `file://` o `data:` (NFR-03).
* **Canal IPC tipado:** contrato único (`MsgDocument`, `ExportRequest`, `AttachmentSaveRequest`) compartido entre main y renderer vía tipos TypeScript, expuesto exclusivamente por `contextBridge` en el preload.

### 7.4 Pipeline de exportación

| Formato | Mecanismo | Origen de los datos |
|---|---|---|
| PDF | `webContents.printToPDF()` sobre el documento renderizado, salida directa al archivo elegido | DOM renderizado |
| EML | Reconstrucción MIME desde las propiedades MAPI parseadas (no desde el DOM) | Modelo parseado |
| PNG | Resize del contenido a altura completa + `webContents.capturePage()`, con límite FR-13 | DOM renderizado |

### 7.5 Riesgos técnicos identificados

| Riesgo | Impacto | Mitigación |
|---|---|---|
| Calidad variable de la conversión RTF→HTML | Fidelidad visual degradada en correos antiguos sin HTML nativo | Corpus de pruebas con correos reales; documentar L-01; evaluar conversores alternativos tras el adapter |
| Correos con VML/MSO exótico generados por Word | Renderizado imperfecto incluso en Chromium | Degradación con gracia; fuera del criterio de aceptación estricto |
| `.msg` adversariales (zip-bomb interno, propiedades gigantes) | DoS local / consumo de memoria | Límites duros de tamaño por propiedad y por adjunto en el adapter de parsing; tests adversariales (NFR-07) |
| Cambios de API en la librería de parsing | Coste de mantenimiento | Patrón adapter (NFR-09) + versión fijada (lockfile) |

---

## 8. Criterios de Aceptación (v1.0)

1. Doble clic en un `.msg` en Nautilus/Dolphin (Linux) y Finder (macOS) abre la aplicación con el mensaje renderizado.
2. Un correo HTML moderno de Outlook 365 se muestra visualmente equivalente a su renderizado en Outlook Web, con imágenes inline visibles y sin ejecución de scripts (verificado con un `.msg` de prueba que contiene `<script>` y manejadores `onload`).
3. Un `.msg` con 3 adjuntos permite guardarlos individualmente y todos a la vez, con integridad binaria verificada por checksum.
4. Las exportaciones PDF, EML y PNG producen archivos abribles por herramientas estándar (visor PDF, Thunderbird para el EML, visor de imágenes).
5. Un archivo corrupto y un archivo cifrado muestran errores descriptivos sin crash.
6. Auditoría de red (tcpdump / Little Snitch) confirma cero tráfico saliente durante apertura, visualización y exportación.
7. Métricas NFR-01, NFR-02, NFR-06 y NFR-11 verificadas en el hardware de referencia.
