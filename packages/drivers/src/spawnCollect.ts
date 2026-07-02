import { spawn } from 'node:child_process';

interface Params {
	command: string;
	args: string[];
	cwd: string;
	/** Written to the child's stdin, then closed. Sidesteps argv length limits for large prompts. */
	stdinText?: string;
	timeoutMs?: number;
}

/**
 * Spawn a harness process, feed stdin, collect output. Rejects on spawn
 * failure or timeout; an exit code is a result, not an exception — the
 * caller owns what it means.
 */
export const spawnCollect = ({ command, args, cwd, stdinText, timeoutMs }: Params) => {
	return new Promise<{ exitCode: number; stdout: string; stderr: string }>((resolve, reject) => {
		const child = spawn(command, args, { cwd, stdio: ['pipe', 'pipe', 'pipe'] });

		let stdout = '';
		let stderr = '';

		const timeout = timeoutMs
			? setTimeout(() => {
					child.kill('SIGKILL');
					reject(new Error(`${command} timed out after ${timeoutMs}ms`));
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

		if (stdinText !== undefined) {
			child.stdin.write(stdinText);
		}

		child.stdin.end();
	});
};
