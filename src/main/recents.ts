import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { app } from 'electron';

/** Archivos recientes (máx. 10), persistidos en userData. Solo rutas locales. */

const MAX_RECENTS = 10;

function storePath(): string {
  return join(app.getPath('userData'), 'recents.json');
}

export function loadRecents(): string[] {
  try {
    const raw = JSON.parse(readFileSync(storePath(), 'utf-8')) as unknown;
    if (!Array.isArray(raw)) return [];
    return raw.filter((p): p is string => typeof p === 'string').slice(0, MAX_RECENTS);
  } catch {
    return [];
  }
}

export function addRecent(path: string): string[] {
  const list = [path, ...loadRecents().filter((p) => p !== path)].slice(0, MAX_RECENTS);
  try {
    writeFileSync(storePath(), JSON.stringify(list, null, 2), 'utf-8');
  } catch {
    // sin persistencia no se rompe nada
  }
  return list;
}

export function clearRecents(): void {
  try {
    writeFileSync(storePath(), '[]', 'utf-8');
  } catch {
    // ídem
  }
}

/** Filtra entradas cuyos archivos ya no existen. */
export function existingRecents(): string[] {
  return loadRecents().filter((p) => existsSync(p));
}
