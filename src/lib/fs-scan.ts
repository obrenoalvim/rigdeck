import fs from 'node:fs';
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
