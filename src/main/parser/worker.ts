import { readFile } from 'node:fs/promises';
import { parentPort } from 'node:worker_threads';
import type { LoadResult } from '@shared/types';
import { MsgAdapter } from './MsgAdapter';

/**
 * Worker de parsing (NFR-01): el archivo se lee y parsea fuera del hilo
 * principal para no congelar la UI con archivos grandes.
 * Protocolo: recibe ParseJob, responde { id, result }.
 */

export interface ParseJob {
  id: number;
  /** Ruta en disco, o bytes en memoria (mensajes .msg incrustados, OBJ-S2). */
  filePath?: string;
  bytes?: Uint8Array;
  virtualPath?: string;
}

export interface ParseReply {
  id: number;
  result: LoadResult;
}

parentPort?.on('message', async (job: ParseJob) => {
  let result: LoadResult;
  try {
    const buffer = job.bytes ? Buffer.from(job.bytes) : await readFile(job.filePath ?? '');
    result = MsgAdapter.parse(buffer, job.filePath ?? job.virtualPath ?? '');
  } catch (e) {
    const err = e as NodeJS.ErrnoException;
    result = {
      ok: false,
      error:
        err.code === 'ENOENT' || err.code === 'EACCES'
          ? { code: 'not-found', detail: err.message }
          : { code: 'parse-error', detail: err.message }
    };
  }
  parentPort?.postMessage({ id: job.id, result } satisfies ParseReply);
});
