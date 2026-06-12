import { join } from 'node:path';
import { Worker } from 'node:worker_threads';
import type { LoadResult } from '@shared/types';
import type { ParseJob, ParseReply } from './parser/worker';

/**
 * Puente al worker de parsing (NFR-01): un único worker reutilizado;
 * si crashea se recrea en la siguiente petición.
 */

let worker: Worker | null = null;
let nextId = 1;
const pending = new Map<number, (result: LoadResult) => void>();

function getWorker(): Worker {
  if (worker) return worker;
  worker = new Worker(join(import.meta.dirname, 'parser/worker.js'));
  worker.on('message', (reply: ParseReply) => {
    pending.get(reply.id)?.(reply.result);
    pending.delete(reply.id);
  });
  worker.on('error', (err: Error) => {
    for (const resolve of pending.values()) {
      resolve({ ok: false, error: { code: 'parse-error', detail: err.message } });
    }
    pending.clear();
    worker = null;
  });
  worker.on('exit', () => {
    // Un exit sin respuesta dejaría promesas colgadas para siempre.
    for (const resolve of pending.values()) {
      resolve({ ok: false, error: { code: 'parse-error', detail: 'Worker terminado' } });
    }
    pending.clear();
    worker = null;
  });
  return worker;
}

function submit(job: Omit<ParseJob, 'id'>): Promise<LoadResult> {
  return new Promise((resolve) => {
    const id = nextId++;
    pending.set(id, resolve);
    getWorker().postMessage({ ...job, id });
  });
}

export function parseFile(filePath: string): Promise<LoadResult> {
  return submit({ filePath });
}

export function parseBytes(bytes: Uint8Array, virtualPath: string): Promise<LoadResult> {
  return submit({ bytes, virtualPath });
}

export function shutdownParser(): void {
  void worker?.terminate();
  worker = null;
}
