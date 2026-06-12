# MSG Viewer

Visor de escritorio ligero y multiplataforma (**Linux y macOS**) para archivos
`.msg` de Microsoft Outlook. Funciona **100% offline**: el contenido del correo
nunca abandona tu equipo.

> En macOS y Linux no hay forma nativa de abrir un `.msg` recibido desde un
> entorno corporativo Windows/Outlook sin instalar Outlook o subir el archivo
> a un servicio web de terceros. MSG Viewer cubre ese vacío.

## Características

### Visualización
- **Mensajes de correo completos**: asunto, remitente, destinatarios (Para/CC/CCO),
  fechas de envío y recepción, cuerpo y adjuntos.
- **Resolución de cuerpo en cascada**: HTML nativo → RTF des-encapsulado
  (recupera el HTML original que Outlook envuelve en RTF, con alta fidelidad) →
  conversión RTF aproximada → texto plano.
- **Imágenes incrustadas** (`cid:`) renderizadas en su posición; las imágenes
  remotas se bloquean y se muestran como placeholder (privacidad por diseño).
- **Mensajes `.msg` anidados**: se abren en ventana propia para comparar
  correos lado a lado.
- **Direcciones de Exchange**: resuelve la dirección SMTP real en lugar de
  mostrar el DN X.500 interno (`/o=ExchangeLabs/...`).
- Tema claro/oscuro automático e interfaz en español e inglés (según el idioma
  del sistema; i18n externalizado para añadir más idiomas).

### Seguridad y privacidad
- El cuerpo del correo se trata siempre como **contenido hostil**: sanitización
  (DOMPurify) + iframe sandbox sin scripts + CSP restrictiva.
- **Bloqueo total de red** en capa de sesión: la aplicación no abre sockets
  externos (verificable con `tcpdump`). Cero telemetría, cero analítica.
- Los adjuntos solo se escriben a disco por acción explícita del usuario;
  los temporales de "Abrir" se purgan al salir.

### Acciones
- **Exportar a PDF** (A4/Carta según región, sin diálogo de impresión),
  **EML** (MIME estándar abrible en Thunderbird) y **PNG** (página completa,
  con opción de **copiar la imagen al portapapeles** para pegarla donde sea).
- **Imprimir** con el diálogo del sistema (Ctrl+P).
- **Adjuntos**: clic para Abrir con la aplicación predeterminada o Guardar;
  "Guardar todos" en una carpeta; integridad binaria garantizada.
- **Copiar direcciones con un clic** (y "copiar todos" por campo).
- Menú contextual: copiar texto, copiar imagen, seleccionar todo.
- Drag & drop de archivos `.msg` en cualquier estado de la ventana.
- **Asociación con el sistema** desde el menú Archivo: doble clic en
  cualquier `.msg` lo abre aquí (Linux vía xdg-mime; en macOS con
  instrucciones de Finder).

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
