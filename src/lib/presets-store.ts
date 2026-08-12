import fs from 'node:fs';
import type { Preset } from '../types.js';

const backupPath = (p: string) => `${p}.bak`;

export function createStore<T extends { id: string } = Preset>(filePath: string) {
  function load(): T[] {
    if (!fs.existsSync(filePath)) return [];
    const raw = fs.readFileSync(filePath, 'utf8');
    try {
      return JSON.parse(raw);
    } catch (e) {
      // Falha alto em vez de cair silenciosamente pra [] -- sumir com todos
      // os presets da tela sem apagar o arquivo e pior que um erro visivel.
      // O .bak (escrito antes de cada save bem-sucedido) tem o ultimo estado
      // valido conhecido, pra restaurar a mao.
      const bak = backupPath(filePath);
      const hint = fs.existsSync(bak) ? ` Backup do ultimo estado valido em "${bak}".` : '';
      throw new Error(`presets.json corrompido (${(e as Error).message}).${hint}`);
    }
  }

  function save(presets: T[]): void {
    // Copia o arquivo ATUAL (ainda valido, senao load() teria falhado antes
    // de chegar aqui) pro .bak antes de sobrescrever -- se a proxima escrita
    // for interrompida no meio (crash, disco cheio), o .bak fica com o
    // ultimo estado bom conhecido.
    if (fs.existsSync(filePath)) fs.copyFileSync(filePath, backupPath(filePath));
    fs.writeFileSync(filePath, JSON.stringify(presets, null, 2));
  }

  function list(): T[] {
    return load();
  }

  function get(id: string): T | undefined {
    return load().find((p) => p.id === id);
  }

  function create(preset: T): T {
    const presets = load();
    presets.push(preset);
    save(presets);
    return preset;
  }

  function update(id: string, data: Partial<T>): T | null {
    const presets = load();
    const idx = presets.findIndex((p) => p.id === id);
    if (idx === -1) return null;
    presets[idx] = { ...presets[idx], ...data, id };
    save(presets);
    return presets[idx];
  }

  function remove(id: string): boolean {
    const presets = load();
    const next = presets.filter((p) => p.id !== id);
    save(next);
    return next.length !== presets.length;
  }

  function replaceAll(items: T[]): T[] {
    save(items);
    return items;
  }

  return { list, get, create, update, remove, replaceAll };
}
