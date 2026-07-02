import { z } from 'zod';
import { spawnCollect } from './spawnCollect';
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
 * engine never sees a credential. Flag surface verified against claude CLI
 * 2.1.198.
 */
export const createClaudeCodeDriver = () => {
	const driver: Driver = {
		name: 'claude-code',
		invoke: async (invocation) => {
			const { prompt, systemPrompt, model, permissionMode, cwd, timeoutMs } = invocation;

			const { exitCode, stdout, stderr } = await spawnCollect({
				command: 'claude',
				args: buildArgs({ systemPrompt, model, permissionMode }),
				cwd,
				stdinText: prompt,
				timeoutMs,
			});

			const envelope = parseEnvelope({ stdout });
			const text = envelope?.result ?? stdout ?? '';
			const errored = envelope?.is_error === true || exitCode !== 0;

			return {
				text: text || stderr,
				exitCode,
				rateLimited: errored && rateLimitPattern.test(`${text}\n${stderr}`),
			};
		},
	};

	return driver;
};
