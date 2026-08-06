import { spawn } from 'node:child_process';
import type { CommandResult } from '@/common/types/CommandResult';

interface Params {
	/** Full shell command from consumer config (e.g. `pnpm --filter api check`). */
	command: string;
	cwd: string;
	timeoutMs?: number;
}

/**
 * The verification gate primitive. Runs a consumer-configured command and
 * returns its exit code — the one signal in the pipeline no model can
 * sweet-talk. Rejects only on spawn failure or timeout; a non-zero exit is a
 * result, not an exception (the engine owns what failure means).
 */
export const runCommand = ({ command, cwd, timeoutMs }: Params) => {
	return new Promise<CommandResult>((resolve, reject) => {
		// `env` is passed explicitly rather than left to ambient inheritance. In
		// production this is identical — the child inherited exactly these values
		// anyway — but it makes the environment a visible input, which is what lets
		// a test stub a binary onto PATH. Some runners (Jest) hand test code a copy
		// of process.env that real child processes do not inherit, so without this
		// a PATH-stubbing test silently probes the machine instead of its fixture.
		const child = spawn(command, { cwd, shell: true, stdio: ['ignore', 'pipe', 'pipe'], env: process.env });

		let stdout = '';
		let stderr = '';

		const timeout = timeoutMs
			? setTimeout(() => {
					child.kill('SIGKILL');
					reject(new Error(`command timed out after ${timeoutMs}ms: ${command}`));
				}, timeoutMs)
			: undefined;

		child.stdout.on('data', (chunk: Buffer) => {
			stdout += chunk.toString();
		});

		child.stderr.on('data', (chunk: Buffer) => {
			stderr += chunk.toString();
		});

		child.on('error', (error) => {
			clearTimeout(timeout);
			reject(error);
		});

		child.on('close', (code) => {
			clearTimeout(timeout);
			resolve({ exitCode: code ?? -1, stdout, stderr });
		});
	});
};
