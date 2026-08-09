import { execFile } from 'node:child_process';
import { logError } from './log.js';

export function launch(target: string): void {
  // cmd.exe treats &, |, ^, etc as its own metacharacters even when passed
  // via execFile (no shell involved on the Node side) -- cmd's own /c parser
  // still splits on them unless the token is quoted. windowsVerbatimArguments
  // lets us quote the target ourselves so cmd sees it as one literal token.
  execFile(
    'cmd.exe',
    ['/c', 'start', '""', `"${target}"`],
    { windowsVerbatimArguments: true },
    (err, _stdout, stderr) => {
      if (err) logError(`launch failed for "${target}":`, err.message, stderr ? `stderr: ${stderr}` : '');
    }
  );
}
