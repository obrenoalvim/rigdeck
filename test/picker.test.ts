import test from 'node:test';
import assert from 'node:assert';
// @ts-expect-error módulo do front (JS puro, sem tipos)
import { acronymOf, matchesQuery, parentOf, iconSrcFor } from '../public/picker.js';

test('acronymOf e matchesQuery acham jogo pela sigla', () => {
  assert.strictEqual(acronymOf('Counter-Strike 2'), 'CS2');
  assert.ok(matchesQuery('Counter-Strike 2', 'cs2'));
  assert.ok(matchesQuery('Counter-Strike 2', 'strike'));
  assert.ok(!matchesQuery('Counter-Strike 2', 'dota'));
});

test('parentOf sobe uma pasta e termina na lista de locais', () => {
  assert.strictEqual(parentOf('C:\\Users\\Ana\\Jogos'), 'C:\\Users\\Ana');
  assert.strictEqual(parentOf('C:\\Users'), 'C:\\');
  assert.strictEqual(parentOf('C:\\'), null);
});

test('iconSrcFor: steam usa CDN, exe usa /api/icon, resto sem icone', () => {
  assert.match(iconSrcFor('steam://rungameid/730'), /apps\/730\/header\.jpg$/);
  assert.match(iconSrcFor('C:\\a\\b.exe'), /^\/api\/icon\?path=/);
  assert.strictEqual(iconSrcFor('https://x.com'), null);
});
