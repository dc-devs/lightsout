import { spawn } from 'node:child_process';

interface Params {
	command: string;
	args: string[];
	cwd: string;
	/** Written to the child's stdin, then closed. Sidesteps argv length limits for large prompts. */
	stdinText?: string;
	timeoutMs?: number;
	/** Called once per complete stdout line as it arrives (empty lines skipped). Full stdout is still collected and returned. */
	onStdoutLine?: (line: string) => void;
}

/**
 * Spawn a harness process, feed stdin, collect output. Rejects on spawn
 * failure or timeout; an exit code is a result, not an exception — the
 * caller owns what it means.
 */
export const spawnCollect = ({ command, args, cwd, stdinText, timeoutMs, onStdoutLine }: Params) => {
	return new Promise<{ exitCode: number; stdout: string; stderr: string }>((resolve, reject) => {
		// `env` is passed explicitly rather than left to ambient inheritance — see
		// the same note in runCommand. It is inert in production and is what makes
		// the harness binary stubbable from a test: without it, a test that empties
		// PATH still spawns the real harness, which costs real money.
		const child = spawn(command, args, { cwd, stdio: ['pipe', 'pipe', 'pipe'], env: process.env });

		let stdout = '';
		let stderr = '';
		let lineBuffer = '';

		const emitLines = (text: string, flush = false) => {
			if (!onStdoutLine) {
				return;
			}

			lineBuffer += text;

			const lines = lineBuffer.split('\n');

			lineBuffer = flush ? '' : (lines.pop() ?? '');

			for (const line of lines) {
				if (line.trim()) {
					onStdoutLine(line);
				}
			}
		};

		const timeout = timeoutMs
			? setTimeout(() => {
					child.kill('SIGKILL');
					reject(new Error(`${command} timed out after ${timeoutMs}ms`));
				}, timeoutMs)
			: undefined;

		child.stdout.on('data', (chunk: Buffer) => {
			const text = chunk.toString();

			stdout += text;
			emitLines(text);
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
			emitLines('', true);
			resolve({ exitCode: code ?? -1, stdout, stderr });
		});

		if (stdinText !== undefined) {
			child.stdin.write(stdinText);
		}

		child.stdin.end();
	});
};
