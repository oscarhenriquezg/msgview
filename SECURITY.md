# Política de seguridad

MSG Viewer es un visor de correo **100 % offline** cuyo objetivo es abrir
archivos `.msg`/`.eml`/`.emlx` —que pueden ser hostiles— sin poner en riesgo al
usuario. La seguridad es parte del propósito del proyecto, así que los informes
de vulnerabilidad son bienvenidos y se tratan con prioridad.

## Versiones soportadas

Solo la última versión publicada recibe correcciones de seguridad.

| Versión | Soporte            |
| ------- | ------------------ |
| 0.2.x   | ✅ Sí              |
| < 0.2   | ❌ No              |

## Cómo reportar una vulnerabilidad

**No abras un issue público** para fallos de seguridad. En su lugar:

1. Preferente: usa **GitHub Security Advisories** →
   [«Report a vulnerability»](https://github.com/oscarhenriquezg/msgview/security/advisories/new).
2. Alternativa: escribe a **oscar.henriquez.gonzalez@gmail.com** con el asunto
   `[SECURITY] msgview`.

Incluye, si puedes:

- versión de la app y sistema operativo;
- pasos para reproducirlo y un archivo de prueba mínimo (`.msg`/`.eml`)
  **anonimizado**, sin datos personales ni corporativos reales;
- el impacto que crees que tiene.

### Qué esperar

- **Acuse de recibo** en un plazo de 72 horas.
- Una evaluación inicial y, si procede, un plan de corrección en un máximo de
  2 semanas.
- Crédito en las notas de la versión que corrija el fallo, si así lo deseas.

Por ser un proyecto personal sin ánimo de lucro no existe un programa de
recompensas (bug bounty).

## Alcance

Especialmente relevante para este proyecto:

- **Ejecución de contenido del correo**: cualquier forma de ejecutar scripts,
  cargar recursos remotos (fuga de IP / tracking pixels) o salir del entorno
  inerte del cuerpo del mensaje.
- **Escape del sandbox del renderer** o acceso indebido a APIs de Node desde el
  contenido mostrado.
- **Escritura de archivos fuera de lo que el usuario elige** al guardar
  adjuntos o exportar (path traversal con nombres de adjunto manipulados).
- **Cuelgues o corrupción** explotables al procesar archivos malformados.

Fuera de alcance: vulnerabilidades en dependencias de terceros ya conocidas y
sin parche disponible (repórtalas aguas arriba), y ataques que requieran que el
usuario deshabilite voluntariamente las protecciones de la app.

## Decisiones de diseño orientadas a seguridad

- El cuerpo del correo se muestra en un `<iframe>` *sandbox* **sin
  `allow-scripts`** y con una CSP que solo permite `data:` para imágenes.
- El HTML se **sanitiza con DOMPurify** en el proceso main antes de llegar al
  renderer; el visor muestra un *diff* de lo eliminado.
- **Bloqueo de red saliente** a nivel de sesión: ningún recurso del mensaje
  sale a Internet (NFR-03).
- El parsing ocurre en un *worker thread* aislado del proceso main.
- Función **Unlink** para inutilizar todos los enlaces de un correo sospechoso,
  y advertencia de confianza antes de abrir cualquier enlace externo.

Estas medidas reducen el riesgo, pero ninguna es perfecta: por eso este
documento existe.
