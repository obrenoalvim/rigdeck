import { execFile } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { launch } from './launch.js';
import { logError } from './log.js';
import type { Monitor, Preset, PresetStep, StepResult } from '../types.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCRIPTS_DIR = path.join(__dirname, '..', '..', 'scripts');
const PLACE_SCRIPT = path.join(SCRIPTS_DIR, 'place-window.ps1');
const OPEN_APP_SCRIPT = path.join(SCRIPTS_DIR, 'open-app-window.ps1');
const CLOSE_WINDOW_SCRIPT = path.join(SCRIPTS_DIR, 'close-window.ps1');
const SEND_KEY_SCRIPT = path.join(SCRIPTS_DIR, 'send-key.ps1');

// --app=<url> so existe em navegadores Chromium -- Firefox ja e um atalho
// separado (nao usa esse modo), entao nem entra na lista.
const APP_BROWSER_CANDIDATES = [
  'C:\\Program Files\\BraveSoftware\\Brave-Browser\\Application\\brave.exe',
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
];

function pickAppBrowser(): string | null {
  return APP_BROWSER_CANDIDATES.find((p) => fs.existsSync(p)) ?? null;
}

function isUrl(target?: string): boolean {
  return /^https?:\/\//i.test(target ?? '');
}

type Handle = { kind: 'hwnd' | 'pid'; value: number };

// Handle (PID de processo OU HWND de janela) da ultima execucao bem-sucedida
// de cada passo, pra "segurar pra fechar" encerrar exatamente o que ESSE
// preset abriu -- nao qualquer processo com o mesmo nome (ex: nao fechar
// outra janela do Chrome que ja tava aberta), nem o navegador inteiro
// quando o passo e uma URL (ai o alvo e a HWND daquela janela especifica,
// ja que o processo do navegador e compartilhado entre varias janelas/abas
// e matar por PID fecharia tudo). So em memoria -- perde no restart do
// servidor, ai cai pro kill por nome (ou fica sem para URLs).
//
// Chave e preset.id + target (nao o indice do passo!) -- se fosse por indice,
// editar o preset (reordenar/remover passo) depois de rodar e antes de matar
// faria o kill usar o handle de outro passo. Como o Windows reusa PID de
// processo encerrado, isso podia matar algo sem nenhuma relacao com o preset.
const lastHandles = new Map<string, Handle>();

export function pidKeyFor(presetId: string, step: PresetStep): string {
  return `${presetId}:${step.target}`;
}

export function processNameFor(step: PresetStep): string | null {
  if (step.processName) return step.processName;
  if (!/\.exe$/i.test(step.target ?? '')) return null;
  return path.basename(step.target!).replace(/\.[^.]+$/, '');
}

function runPs(args: string[], timeoutMs: number, label: string): Promise<StepResult> {
  return new Promise((resolve) => {
    execFile('powershell.exe', args, { timeout: timeoutMs }, (err, stdout, stderr) => {
      if (err) {
        logError(`${label} exec failed:`, err.message, stderr ? `stderr: ${stderr}` : '');
        return resolve({ ok: false, error: err.message });
      }
      try {
        resolve(JSON.parse(String(stdout).trim()));
      } catch {
        logError(`${label} gave unparseable output:`, `stdout: ${JSON.stringify(stdout)}`, stderr ? `stderr: ${stderr}` : '');
        resolve({ ok: false, error: `bad script output: ${String(stdout).slice(0, 200)}` });
      }
    });
  });
}

function placeWindow(step: PresetStep, monitor: Monitor): Promise<StepResult> {
  const processName = processNameFor(step);
  if (!processName) {
    return Promise.resolve({
      ok: true,
      note: 'launched, window placement skipped (no .exe target and no processo set — preencha "processo" pra posicionar essa janela)',
    });
  }
  const args = [
    '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', PLACE_SCRIPT,
    '-ProcessName', processName,
    '-X', String(monitor.x), '-Y', String(monitor.y),
    '-Width', String(monitor.width), '-Height', String(monitor.height),
  ];
  if (step.fullscreen) args.push('-Fullscreen');
  return runPs(args, 65000, `place-window.ps1 ("${step.target}", process "${processName}")`);
}

function openAppWindow(step: PresetStep, monitor: Monitor): Promise<StepResult> {
  const browser = pickAppBrowser();
  if (!browser) {
    return Promise.resolve({
      ok: false,
      error: 'nenhum navegador Chromium encontrado pra abrir em modo app (Brave/Chrome/Edge)',
    });
  }
  const args = [
    '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', OPEN_APP_SCRIPT,
    '-BrowserExe', browser,
    '-Url', step.target!,
    '-X', String(monitor.x), '-Y', String(monitor.y),
    '-Width', String(monitor.width), '-Height', String(monitor.height),
  ];
  if (step.fullscreen) args.push('-Fullscreen');
  return runPs(args, 35000, `open-app-window.ps1 ("${step.target}")`);
}

function closeByHwnd(hwnd: number): Promise<StepResult> {
  return runPs(
    ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', CLOSE_WINDOW_SCRIPT, '-Hwnd', String(hwnd)],
    15000,
    'close-window.ps1'
  );
}

function runCommand(command?: string): Promise<StepResult> {
  return new Promise((resolve) => {
    execFile('cmd.exe', ['/c', command ?? ''], { timeout: 30000, windowsHide: true }, (err, stdout, stderr) => {
      if (err && (err as NodeJS.ErrnoException & { killed?: boolean }).killed) {
        return resolve({ ok: false, error: 'comando demorou demais (timeout de 30s)' });
      }
      if (err) {
        logError(`comando cmd falhou: "${command}":`, err.message, stderr ? `stderr: ${stderr}` : '');
        return resolve({ ok: false, error: (stderr || err.message).trim().slice(0, 500) });
      }
      resolve({ ok: true, output: String(stdout).trim().slice(0, 500) });
    });
  });
}

function sendKey(key?: string, processName?: string): Promise<StepResult> {
  const args = ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-STA', '-File', SEND_KEY_SCRIPT, '-Key', key ?? ''];
  if (processName) args.push('-ProcessName', processName);
  return runPs(args, 20000, `send-key.ps1 (key "${key}")`);
}

function killProcess(processName: string): Promise<StepResult> {
  return new Promise((resolve) => {
    execFile('taskkill', ['/F', '/IM', `${processName}.exe`], (err, _stdout, stderr) => {
      resolve(err ? { ok: false, error: (stderr || err.message).trim() } : { ok: true });
    });
  });
}

function killByPid(pid: number): Promise<StepResult> {
  return new Promise((resolve) => {
    // /T mata a arvore de processos filhos tambem -- pega o caso de
    // bootstrapper/launcher que repassa pro processo real do jogo.
    execFile('taskkill', ['/F', '/PID', String(pid), '/T'], (err, _stdout, stderr) => {
      resolve(err ? { ok: false, error: (stderr || err.message).trim() } : { ok: true, note: 'encerrado pelo PID exato' });
    });
  });
}

export async function killPreset(preset: Preset): Promise<StepResult[]> {
  const results: StepResult[] = [];
  for (const step of preset.steps ?? []) {
    if (step.type === 'cmd' || step.type === 'key') {
      continue; // comando/tecla ja disparou e acabou, nao ha nada pra "segurar-pra-fechar"
    }
    const pidKey = pidKeyFor(preset.id, step);
    const tracked = lastHandles.get(pidKey);
    if (tracked) {
      const result = tracked.kind === 'hwnd' ? await closeByHwnd(tracked.value) : await killByPid(tracked.value);
      lastHandles.delete(pidKey);
      if (result.ok) {
        results.push({ step: step.target, ...result });
        continue;
      }
      // Handle nao existe mais (janela/processo ja tinha fechado) -- cai pro nome.
    }
    const processName = processNameFor(step);
    if (!processName) {
      results.push({ step: step.target, ok: false, error: 'sem processo conhecido pra encerrar' });
      continue;
    }
    const result = await killProcess(processName);
    results.push({ step: step.target, ...result });
  }
  return results;
}

export async function runPreset(preset: Preset, monitors: Monitor[]): Promise<StepResult[]> {
  const results: StepResult[] = [];
  for (const step of preset.steps ?? []) {
    if (step.type === 'cmd') {
      const result = await runCommand(step.command);
      results.push({ step: step.command, ...result });
      continue;
    }

    if (step.type === 'key') {
      const result = await sendKey(step.key, step.processName);
      results.push({ step: step.key, ...result });
      continue;
    }

    let monitor = monitors[step.monitor ?? 0];
    if (!monitor) monitor = monitors.find((m) => m.primary) ?? monitors[0];
    if (!monitor) {
      results.push({ step: step.target, ok: false, error: 'no monitor available' });
      continue;
    }
    const pidKey = pidKeyFor(preset.id, step);
    lastHandles.delete(pidKey); // nao deixa um handle de execucao anterior sobrar se essa falhar
    if (isUrl(step.target)) {
      const result = await openAppWindow(step, monitor);
      if (typeof result.hwnd === 'number') lastHandles.set(pidKey, { kind: 'hwnd', value: result.hwnd });
      results.push({ step: step.target, ...result });
    } else {
      launch(step.target!);
      const result = await placeWindow(step, monitor);
      if (typeof result.pid === 'number') lastHandles.set(pidKey, { kind: 'pid', value: result.pid });
      results.push({ step: step.target, ...result });
    }
  }
  return results;
}
