import { execFile } from 'node:child_process';
import { logError } from './log.js';

export function launch(target: string): void {
  execFile(
    'cmd.exe',
    ['/c', 'start', '""', `"${target}"`],
    { windowsVerbatimArguments: true },
    (err, _stdout, stderr) => {
      if (err) logError(`launch failed for "${target}":`, err.message, stderr ? `stderr: ${stderr}` : '');
    }
  );
}
