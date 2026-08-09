import { execFile } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCRIPT = path.join(__dirname, '..', '..', 'scripts', 'get-icon.ps1');
const cache = new Map<string, Promise<Buffer | null>>();

export function extractIcon(exePath: string): Promise<Buffer | null> {
  if (cache.has(exePath)) return cache.get(exePath)!;
  const promise = new Promise<Buffer | null>((resolve) => {
    execFile(
      'powershell.exe',
      ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', SCRIPT, '-Path', exePath],
      { maxBuffer: 1024 * 1024 * 10 },
      (err, stdout) => {
        if (err || !stdout.trim()) {
          // nao guarda falha em cache -- pode ser passageiro (ex: exe ainda
          // nao existia, PowerShell ocupado). Tenta de novo na proxima chamada.
          cache.delete(exePath);
          return resolve(null);
        }
        resolve(Buffer.from(stdout.trim(), 'base64'));
      }
    );
  });
  cache.set(exePath, promise);
  return promise;
}
