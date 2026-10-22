import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export interface FsEntry {
  name: string;
  path: string;
  isDir: boolean;
}

export function scanDir(dirPath: string): FsEntry[] {
  const entries = fs
    .readdirSync(dirPath, { withFileTypes: true })
    .filter((d) => !d.name.startsWith('.'))
    .map((d) => ({ name: d.name, path: path.join(dirPath, d.name), isDir: d.isDirectory() }));
  entries.sort((a, b) => (a.isDir !== b.isDir ? (a.isDir ? -1 : 1) : a.name.localeCompare(b.name)));
  return entries;
}

export function listRoots(): FsEntry[] {
  const home = os.homedir();
  const roots: FsEntry[] = [
    { name: 'Área de Trabalho', path: path.join(home, 'Desktop') },
    { name: 'Documentos', path: path.join(home, 'Documents') },
    { name: 'Downloads', path: path.join(home, 'Downloads') },
    { name: 'Usuário', path: home },
  ]
    .filter((r) => fs.existsSync(r.path))
    .map((r) => ({ ...r, isDir: true }));
  for (let c = 65; c <= 90; c++) {
    const drive = String.fromCharCode(c) + ':\\';
    if (fs.existsSync(drive)) roots.push({ name: drive, path: drive, isDir: true });
  }
  return roots;
}
