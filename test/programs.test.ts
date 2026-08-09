import test from 'node:test';
import assert from 'node:assert';
import { parseProgramsOutput } from '../src/lib/programs.js';

test('normaliza objeto unico em array de 1', () => {
  const out = parseProgramsOutput('{"name":"Discord","target":"C:\\\\Discord\\\\Discord.exe"}');
  assert.deepStrictEqual(out, [{ name: 'Discord', target: 'C:\\Discord\\Discord.exe' }]);
});

test('mantem array quando ja e array', () => {
  const out = parseProgramsOutput('[{"name":"Discord","target":"C:\\\\a.exe"},{"name":"Steam","target":"C:\\\\b.exe"}]');
  assert.strictEqual(out.length, 2);
  assert.strictEqual(out[1].name, 'Steam');
});

test('string vazia retorna array vazio', () => {
  assert.deepStrictEqual(parseProgramsOutput(''), []);
});
