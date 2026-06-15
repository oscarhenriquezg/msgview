import { describe, expect, it } from 'vitest';
import { isExecutableAttachment } from '../../src/shared/executable';

describe('isExecutableAttachment', () => {
  it('detecta ejecutables/scripts comunes de cada plataforma', () => {
    for (const ext of ['.exe', '.msi', '.bat', '.cmd', '.ps1', '.vbs', '.js', '.jar',
      '.dmg', '.app', '.pkg', '.command', '.sh', '.bash', '.run', '.deb', '.rpm',
      '.appimage', '.py', '.rb', '.apk', '.scr', '.lnk']) {
      expect(isExecutableAttachment(ext), ext).toBe(true);
    }
  });

  it('no marca documentos ni medios normales', () => {
    for (const ext of ['.pdf', '.docx', '.xlsx', '.png', '.jpg', '.txt', '.csv',
      '.zip', '.msg', '.eml', '.mp4', '.html']) {
      expect(isExecutableAttachment(ext), ext).toBe(false);
    }
  });

  it('normaliza caja y punto faltante', () => {
    expect(isExecutableAttachment('.EXE')).toBe(true);
    expect(isExecutableAttachment('exe')).toBe(true);
    expect(isExecutableAttachment('SH')).toBe(true);
    expect(isExecutableAttachment('')).toBe(false);
  });
});
