import { execFileSync } from 'node:child_process';

/** One command run inside a repository under test, with its stdout returned and its stderr captured rather than printed. */
export const runInRepo = ({ cwd, command, args }: { cwd: string; command: string; args: string[] }): string =>
	execFileSync(command, args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
