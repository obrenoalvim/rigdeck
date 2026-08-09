import test from 'node:test';
import assert from 'node:assert';
import { parseMonitorsOutput } from '../src/lib/monitors.js';

test('normaliza objeto unico em array de 1', () => {
  const out = parseMonitorsOutput('{"primary":true,"x":0,"y":0,"width":1920,"height":1080}');
  assert.deepStrictEqual(out, [{ primary: true, x: 0, y: 0, width: 1920, height: 1080 }]);
});

test('mantem array quando ja e array', () => {
  const out = parseMonitorsOutput(
    '[{"primary":true,"x":0,"y":0,"width":1920,"height":1080},{"primary":false,"x":1920,"y":0,"width":1080,"height":1920}]'
  );
  assert.strictEqual(out.length, 2);
  assert.strictEqual(out[1].x, 1920);
});

test('string vazia retorna array vazio', () => {
  assert.deepStrictEqual(parseMonitorsOutput(''), []);
  assert.deepStrictEqual(parseMonitorsOutput('   '), []);
});
