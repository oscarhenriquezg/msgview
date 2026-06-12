/**
 * Límites duros contra .msg adversariales (SRS §7.5, NFR-07).
 * Un archivo que exceda estos límites produce un LoadError descriptivo,
 * nunca un consumo de memoria descontrolado.
 */

/** Tamaño máximo del archivo .msg aceptado. */
export const MAX_FILE_SIZE = 500 * 1024 * 1024;

/** Tamaño máximo del cuerpo (HTML/RTF/texto) tras descompresión. */
export const MAX_BODY_BYTES = 64 * 1024 * 1024;

/** Número máximo de adjuntos listados. */
export const MAX_ATTACHMENTS = 512;

/** Tamaño máximo de una imagen inline convertida a data: URI. */
export const MAX_INLINE_IMAGE_BYTES = 32 * 1024 * 1024;

/** Presupuesto total de imágenes inline incrustadas en el HTML. */
export const MAX_TOTAL_INLINE_BYTES = 128 * 1024 * 1024;

/** Profundidad máxima de .msg anidados abribles (OBJ-S2). */
export const MAX_EMBEDDED_DEPTH = 8;
