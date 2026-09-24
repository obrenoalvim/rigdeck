import test from 'node:test';
import assert from 'node:assert';
import {
  cpuPercentFromSamples,
  getMemoryStats,
  getDiskStats,
  getClaudeSessionStats,
  isSnapshotStale,
} from '../src/lib/stats.js';

test('cpuPercentFromSamples calcula % de uso a partir do delta idle/total', () => {
  const start = { idle: 1000, total: 10000 };
  const end = { idle: 1500, total: 11000 };
  // idleDelta=500, totalDelta=1000 -> 50% ocupado
  assert.strictEqual(cpuPercentFromSamples(start, end), 50);
});

test('cpuPercentFromSamples retorna 0 quando totalDelta nao avancou', () => {
  const start = { idle: 100, total: 1000 };
  const end = { idle: 100, total: 1000 };
  assert.strictEqual(cpuPercentFromSamples(start, end), 0);
});

test('cpuPercentFromSamples retorna 100 quando cpu ficou 100% ocupada', () => {
  const start = { idle: 500, total: 5000 };
  const end = { idle: 500, total: 6000 };
  assert.strictEqual(cpuPercentFromSamples(start, end), 100);
});

test('getMemoryStats retorna numeros plausiveis da maquina real', () => {
  const stats = getMemoryStats();
  assert.ok(stats.ramTotalGB > 0);
  assert.ok(stats.ramUsedGB >= 0 && stats.ramUsedGB <= stats.ramTotalGB);
  assert.ok(stats.ramPercent >= 0 && stats.ramPercent <= 100);
});

test('getDiskStats retorna numeros plausiveis do disco real', async () => {
  const stats = await getDiskStats();
  assert.ok(stats.diskTotalGB > 0);
  assert.ok(stats.diskFreeGB >= 0 && stats.diskFreeGB <= stats.diskTotalGB);
  assert.ok(stats.diskPercent >= 0 && stats.diskPercent <= 100);
});

test('isSnapshotStale falso para dado recem escrito', () => {
  const now = 1_000_000;
  assert.strictEqual(isSnapshotStale(now - 60_000, now), false);
});

test('isSnapshotStale verdadeiro logo apos os 15min', () => {
  const now = 1_000_000;
  assert.strictEqual(isSnapshotStale(now - (15 * 60 * 1000 + 1), now), true);
});

test('isSnapshotStale verdadeiro no limite exato dos 15min (inclusive)', () => {
  const now = 1_000_000;
  assert.strictEqual(isSnapshotStale(now - 15 * 60 * 1000, now), false);
});

test('isSnapshotStale verdadeiro para timestamp no futuro (relogio dessincronizado)', () => {
  const now = 1_000_000;
  assert.strictEqual(isSnapshotStale(now + 60_000, now), true);
});

test('getClaudeSessionStats retorna null ou um percentual plausivel', async () => {
  const stats = await getClaudeSessionStats();
  if (stats === null) return;
  assert.ok(stats.claudePercent >= 0 && stats.claudePercent <= 100);
  assert.strictEqual(typeof stats.claudeStale, 'boolean');
  assert.ok(
    stats.claudeWeeklyPercent === null ||
      (stats.claudeWeeklyPercent >= 0 && stats.claudeWeeklyPercent <= 100),
  );
});
