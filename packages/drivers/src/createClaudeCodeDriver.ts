import { spawn } from 'node:child_process';
import { z } from 'zod';
import type { Driver } from './Driver';

/**
 * Headless result envelope from `claude -p --output-format json`. Only
 * `result` and `is_error` are consumed; unknown fields are ignored (parse,
 * don't cast).
 */
const ResultEnvelope = z.object({
	result: z.string().optional(),
	is_error: z.boolean().optional(),
});

const parseEnvelope = ({ stdout }: { stdout: string }) => {
	try {
		return ResultEnvelope.parse(JSON.parse(stdout));
	} catch {
		return undefined;
	}
};

/**
 * Best-effort rate-limit detection: only consulted on error paths (is_error
 * or non-zero exit), so legitimate agent text about "rate limits" can never
 * trip it. A false negative degrades to a normal step failure.
 */
const rateLimitPattern = /usage limit|rate limit|limit reached|limit will reset/i;

const buildArgs = ({
	systemPrompt,
	model,
	permissionMode,
}: {
	systemPrompt?: string;
	model?: string;
	permissionMode?: string;
}) => {
	const args = ['-p', '--output-format', 'json'];

	if (systemPrompt) {
		// Append, never replace: keeps the harness's default agent behavior,
		// mirroring how the Agent tool layers a role prompt onto a subagent.
		args.push('--append-system-prompt', systemPrompt);
	}

	if (model) {
		args.push('--model', model);
	}

	if (permissionMode) {
		args.push('--permission-mode', permissionMode);
	}

	return args;
};

/**
 * Driver for the Claude Code CLI in headless mode (`claude -p`).
 *
 * Spawns the user's own installed, logged-in `claude` binary — auth and
 * billing ride the user's existing session (e.g. a Max subscription), and the
 * engine never sees a credential. The prompt travels via stdin to sidestep
 * argv length limits. Flag surface verified against claude CLI 2.1.198.
 *
 * Rejects on spawn failure or timeout; otherwise resolves with the final text
 * and exit code — the engine owns all judgment about what they mean.
 */
export const createClaudeCodeDriver = () => {
	const driver: Driver = {
		name: 'claude-code',
		invoke: (invocation) => {
			return new Promise((resolve, reject) => {
				const { prompt, systemPrompt, model, permissionMode, cwd, timeoutMs } = invocation;

				const child = spawn('claude', buildArgs({ systemPrompt, model, permissionMode }), {
					cwd,
					stdio: ['pipe', 'pipe', 'pipe'],
				});

				let stdout = '';
				let stderr = '';

				const timeout = timeoutMs
					? setTimeout(() => {
							child.kill('SIGKILL');
							reject(new Error(`claude-code driver timed out after ${timeoutMs}ms`));
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

					const envelope = parseEnvelope({ stdout });
					const exitCode = code ?? -1;
					const text = envelope?.result ?? stdout ?? '';
					const errored = envelope?.is_error === true || exitCode !== 0;

					resolve({
						text: text || stderr,
						exitCode,
						rateLimited: errored && rateLimitPattern.test(`${text}\n${stderr}`),
					});
				});

				child.stdin.write(prompt);
				child.stdin.end();
			});
		},
	};

	return driver;
};
