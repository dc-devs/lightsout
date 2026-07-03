import { z } from 'zod';
import { spawnCollect } from './spawnCollect';
import type { Driver } from './Driver';

/**
 * The final `result` event of `claude -p --output-format stream-json`
 * (verified against claude 2.1.200). Only `result` and `is_error` drive the
 * driver's verdict; the full raw event — usage, cost, everything — flows to
 * `onEvent` untouched. Parse, don't cast.
 */
const ResultEnvelope = z.object({
	result: z.string().optional(),
	is_error: z.boolean().optional(),
});

const ResultEvent = ResultEnvelope.extend({ type: z.literal('result') });

/** Fallback for non-stream output (`--output-format json`): the whole stdout is one envelope. */
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
	allowedCommands,
}: {
	systemPrompt?: string;
	model?: string;
	permissionMode?: string;
	allowedCommands?: string[];
}) => {
	// stream-json (which requires --verbose in print mode) instead of json:
	// same final result payload, but every intermediate event — tool calls,
	// token ticks — arrives live for transcripts and progress narration.
	const args = ['-p', '--output-format', 'stream-json', '--verbose'];

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

	if (allowedCommands && allowedCommands.length > 0) {
		// `Bash(<prefix>:*)` is the CLI's prefix-match permission rule;
		// --allowedTools is variadic, one rule per granted prefix. Additive
		// only — user settings that already allow more stay in charge.
		args.push('--allowedTools', ...allowedCommands.map((prefix) => `Bash(${prefix}:*)`));
	}

	return args;
};

/**
 * Driver for the Claude Code CLI in headless mode (`claude -p`).
 *
 * Spawns the user's own installed, logged-in `claude` binary — auth and
 * billing ride the user's existing session (e.g. a Max subscription), and the
 * engine never sees a credential. Flag surface and stream-json event shapes
 * verified against claude CLI 2.1.200.
 */
export const createClaudeCodeDriver = () => {
	const driver: Driver = {
		name: 'claude-code',
		invoke: async (invocation) => {
			const { prompt, systemPrompt, model, permissionMode, allowedCommands, cwd, timeoutMs, onEvent } = invocation;

			let resultEvent: z.infer<typeof ResultEvent> | undefined;

			const { exitCode, stdout, stderr } = await spawnCollect({
				command: 'claude',
				args: buildArgs({ systemPrompt, model, permissionMode, allowedCommands }),
				cwd,
				stdinText: prompt,
				timeoutMs,
				onStdoutLine: (line) => {
					let event: unknown;

					try {
						event = JSON.parse(line);
					} catch {
						return;
					}

					const parsed = ResultEvent.safeParse(event);

					if (parsed.success) {
						resultEvent = parsed.data;
					}

					onEvent?.(event);
				},
			});

			const envelope = resultEvent ?? parseEnvelope({ stdout });
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
