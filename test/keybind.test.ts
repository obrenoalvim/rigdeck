import test from 'node:test';
import assert from 'node:assert';
import { translateKeybind } from '../src/lib/keybind.js';

test('ctrl+digito simples', () => {
  assert.strictEqual(translateKeybind('ctrl+1'), '^1');
});

test('alt+letra', () => {
  assert.strictEqual(translateKeybind('alt+q'), '%q');
});

test('multiplos modificadores', () => {
  assert.strictEqual(translateKeybind('ctrl+shift+5'), '^+5');
});

test('tecla nomeada (funcao)', () => {
  assert.strictEqual(translateKeybind('ctrl+f1'), '^{F1}');
});

test('numpad', () => {
  assert.strictEqual(translateKeybind('ctrl+num1'), '^{NUMPAD1}');
});

test('espaco', () => {
  assert.strictEqual(translateKeybind('ctrl+space'), '^ ');
});

test('case insensitive e espacos sobrando', () => {
  assert.strictEqual(translateKeybind(' CTRL + 1 '), '^1');
});

test('sem modificador, so a tecla', () => {
  assert.strictEqual(translateKeybind('f5'), '{F5}');
});

test('modificador desconhecido lanca erro', () => {
  assert.throws(() => translateKeybind('win+1'), /modificador desconhecido/);
});

test('tecla desconhecida lanca erro', () => {
  assert.throws(() => translateKeybind('ctrl+banana'), /tecla desconhecida/);
});

test('atalho vazio lanca erro', () => {
  assert.throws(() => translateKeybind(''), /atalho vazio/);
});
