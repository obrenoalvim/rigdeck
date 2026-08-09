import fs from 'node:fs';
import type { Preset } from '../types.js';

export function createStore(filePath: string) {
  function load(): Preset[] {
    if (!fs.existsSync(filePath)) return [];
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  }

  function save(presets: Preset[]): void {
    fs.writeFileSync(filePath, JSON.stringify(presets, null, 2));
  }

  function list(): Preset[] {
    return load();
  }

  function get(id: string): Preset | undefined {
    return load().find((p) => p.id === id);
  }

  function create(preset: Preset): Preset {
    const presets = load();
    presets.push(preset);
    save(presets);
    return preset;
  }

  function update(id: string, data: Partial<Preset>): Preset | null {
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

  function replaceAll(items: Preset[]): Preset[] {
    save(items);
    return items;
  }

  return { list, get, create, update, remove, replaceAll };
}
