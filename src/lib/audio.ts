import { execFile, spawn, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCRIPTS_DIR = path.join(__dirname, '..', '..', 'scripts');

const EQ_CONFIG_PATH = 'C:\\Program Files\\EqualizerAPO\\config\\config.txt';
const EQ_BASS_FC = 150;
const EQ_TREBLE_FC = 8000;

const GET_AUDIO_STATE_SCRIPT = path.join(SCRIPTS_DIR, 'get-audio-state.ps1');
const SET_AUDIO_VOLUME_SCRIPT = path.join(SCRIPTS_DIR, 'set-audio-volume.ps1');
const METERS_STREAM_SCRIPT = path.join(SCRIPTS_DIR, 'audio-meters-stream.ps1');
const VOICE_EFFECT_SCRIPT = path.join(SCRIPTS_DIR, 'send-voice-effect.ps1');

const VOICE_EFFECTS: Record<string, number> = {
  none: 0,
  alien: 1,
  atari: 2,
  clone: 3,
  mutation: 4,
  fastMutation: 5,
  slowMutation: 6,
  malePitch: 7,
  femalePitch: 8,
  heliumPitch: 9,
  babyPitch: 10,
  radio: 11,
  robot: 12,
  customPitch: 13,
  silence: 14,
};

export interface AudioSession {
  pid: number;
  processName: string;
  exePath: string | null;
  volume: number;
  muted: boolean;
}

export interface AudioState {
  master: { volume: number; muted: boolean };
  mic: { available: boolean; volume: number; muted: boolean };
  sessions: AudioSession[];
}

export function parseAudioStateOutput(json: string): AudioState {
  const data = JSON.parse(json);
  if (!data.ok) throw new Error(data.error || 'falha lendo estado de audio');
  const mic = data.mic || {};
  return {
    master: { volume: data.master.volume, muted: !!data.master.muted },
    mic: { available: !!mic.available, volume: mic.volume || 0, muted: !!mic.muted },
    sessions: (data.sessions || []).map((s: any) => ({
      pid: s.pid,
      processName: s.processName,
      exePath: s.exePath || null,
      volume: s.volume,
      muted: !!s.muted,
    })),
  };
}

export function getAudioState(): Promise<AudioState> {
  return new Promise((resolve, reject) => {
    execFile(
      'powershell.exe',
      ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', GET_AUDIO_STATE_SCRIPT],
      { timeout: 10000, maxBuffer: 1024 * 1024 * 5 },
      (err, stdout) => {
        if (err) return reject(err);
        try {
          resolve(parseAudioStateOutput(stdout));
        } catch (e) {
          reject(e);
        }
      }
    );
  });
}

export interface SetVolumeParams {
  target: string;
  pid?: number | string | null;
  volume?: number | null;
  muted?: boolean | null;
}

export function setAudioVolume({ target, pid, volume, muted }: SetVolumeParams): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const args = ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', SET_AUDIO_VOLUME_SCRIPT, '-Target', target];
    if (pid != null) args.push('-ProcessId', String(pid));
    if (volume != null) args.push('-Volume', String(volume));
    if (muted != null) args.push('-Muted', String(!!muted));
    execFile('powershell.exe', args, { timeout: 10000 }, (err, stdout) => {
      if (err) return reject(err);
      let result: any;
      try {
        result = JSON.parse(String(stdout).trim());
      } catch {
        return reject(new Error(`bad script output: ${String(stdout).slice(0, 200)}`));
      }
      if (!result.ok) return reject(new Error(result.error || 'falha desconhecida'));
      broadcastAudioStateChanged();
      resolve(result);
    });
  });
}

type MeterCallback = (data: Record<string, unknown>) => void;

let meterProcess: ChildProcess | null = null;
const meterSubscribers = new Set<MeterCallback>();

function broadcastAudioStateChanged(): void {
  for (const cb of meterSubscribers) cb({ type: 'state-changed' });
}

function startMeterStream(): void {
  if (meterProcess) return;
  meterProcess = spawn('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', METERS_STREAM_SCRIPT]);
  const rl = readline.createInterface({ input: meterProcess.stdout! });
  rl.on('line', (line) => {
    if (!line.trim()) return;
    let data: Record<string, unknown>;
    try {
      data = JSON.parse(line);
    } catch {
      return;
    }
    for (const cb of meterSubscribers) cb(data);
  });
  meterProcess.on('exit', () => {
    meterProcess = null;
    if (meterSubscribers.size > 0) startMeterStream();
  });
}

function stopMeterStream(): void {
  if (!meterProcess) return;
  meterProcess.kill();
  meterProcess = null;
}

export function subscribeMeters(callback: MeterCallback): () => void {
  if (meterSubscribers.size === 0) startMeterStream();
  meterSubscribers.add(callback);
  return () => {
    meterSubscribers.delete(callback);
    if (meterSubscribers.size === 0) stopMeterStream();
  };
}

export function clampDb(v: unknown, fallback: number, min = -12, max = 12): number {
  const n = Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}

const EQ_BLOCK_START = '# rigdeck-eq (gerenciado pelo rigdeck, nao edite a mao)';
const EQ_BLOCK_END = '# /rigdeck-eq';
const EQ_BLOCK_RE = /# rigdeck-eq \(gerenciado pelo rigdeck, nao edite a mao\)[\s\S]*?# \/rigdeck-eq\n?/;

export function eqBlock(bass: number, treble: number): string {
  return `${EQ_BLOCK_START}\nFilter: ON LSC Fc ${EQ_BASS_FC} Hz Gain ${bass} dB\nFilter: ON HSC Fc ${EQ_TREBLE_FC} Hz Gain ${treble} dB\n${EQ_BLOCK_END}\n`;
}

export function parseEqBlock(content: string): { bass: number; treble: number } {
  const block = content.match(EQ_BLOCK_RE);
  const scope = block ? block[0] : '';
  const bassMatch = scope.match(/ON LSC Fc [\d.]+ Hz Gain (-?[\d.]+) dB/);
  const trebleMatch = scope.match(/ON HSC Fc [\d.]+ Hz Gain (-?[\d.]+) dB/);
  return {
    bass: bassMatch ? Number(bassMatch[1]) : 0,
    treble: trebleMatch ? Number(trebleMatch[1]) : 0,
  };
}

export function getEqState(): { installed: boolean; bass: number; treble: number } {
  if (!fs.existsSync(EQ_CONFIG_PATH)) return { installed: false, bass: 0, treble: 0 };
  const content = fs.readFileSync(EQ_CONFIG_PATH, 'utf8');
  return { installed: true, ...parseEqBlock(content) };
}

export function setEq({ bass, treble }: { bass?: number | null; treble?: number | null }): { bass: number; treble: number } {
  if (!fs.existsSync(EQ_CONFIG_PATH)) throw new Error('Equalizer APO nao instalado');
  const current = getEqState();
  const nextBass = clampDb(bass != null ? bass : current.bass, current.bass);
  const nextTreble = clampDb(treble != null ? treble : current.treble, current.treble);

  const existing = fs.readFileSync(EQ_CONFIG_PATH, 'utf8');
  const block = eqBlock(nextBass, nextTreble);
  const next = EQ_BLOCK_RE.test(existing)
    ? existing.replace(EQ_BLOCK_RE, block)
    : `${existing.replace(/\n?$/, '\n')}${block}`;
  fs.writeFileSync(EQ_CONFIG_PATH, next);
  return { bass: nextBass, treble: nextTreble };
}

function runVoiceScript(args: string[]): Promise<any> {
  return new Promise((resolve, reject) => {
    execFile(
      'powershell.exe',
      ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', VOICE_EFFECT_SCRIPT, ...args],
      { timeout: 5000 },
      (err, stdout) => {
        if (err) return reject(err);
        try {
          resolve(JSON.parse(String(stdout).trim()));
        } catch {
          reject(new Error(`bad script output: ${String(stdout).slice(0, 200)}`));
        }
      }
    );
  });
}

export async function getVoiceState(): Promise<{ running: boolean }> {
  const result = await runVoiceScript(['-DetectOnly']).catch(() => ({ ok: false }));
  return { running: !!result.ok };
}

export interface VoiceEffectParams {
  voice?: string;
  pitch?: number | null;
  enabled?: boolean | null;
}

export function buildVoiceArgs({ voice, pitch, enabled }: VoiceEffectParams): string[] {
  if (enabled != null) {
    return ['-Command', '2', '-Arg1', enabled ? '0' : '1']; // 0=liga, 1=desliga no protocolo do Clownfish
  }
  if (voice === 'customPitch') {
    const clamped = clampDb(pitch != null ? pitch : 0, 0, -15, 15);
    return ['-Command', '3', '-Arg1', String(VOICE_EFFECTS.customPitch), '-Arg2', String(clamped)];
  }
  const id = voice ? VOICE_EFFECTS[voice] : undefined;
  if (id == null) throw new Error(`efeito de voz desconhecido: ${voice}`);
  return ['-Command', '3', '-Arg1', String(id)];
}

export async function setVoiceEffect(params: VoiceEffectParams): Promise<any> {
  const result = await runVoiceScript(buildVoiceArgs(params));
  if (!result.ok) throw new Error(result.error || 'falha desconhecida');
  return result;
}
