import test from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { scanDir } from '../src/lib/fs-scan.js';

test('scanDir lista pastas antes de arquivos, cada grupo em ordem alfabetica, ignora dotfiles', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rigdeck-fs-scan-'));
  try {
    fs.writeFileSync(path.join(dir, 'zeta.txt'), '');
    fs.writeFileSync(path.join(dir, 'alpha.txt'), '');
    fs.mkdirSync(path.join(dir, 'sub-b'));
    fs.mkdirSync(path.join(dir, 'sub-a'));
    fs.writeFileSync(path.join(dir, '.hidden'), '');

    const entries = scanDir(dir);
    assert.deepStrictEqual(
      entries.map((e) => e.name),
      ['sub-a', 'sub-b', 'alpha.txt', 'zeta.txt']
    );
    assert.strictEqual(entries[0].isDir, true);
    assert.strictEqual(entries[2].isDir, false);
    assert.strictEqual(entries[2].path, path.join(dir, 'alpha.txt'));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
