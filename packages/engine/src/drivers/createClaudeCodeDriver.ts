import { z } from 'zod';
import { buildClaudeCodeArgs } from '#src/drivers/buildClaudeCodeArgs.ts';
import type { Driver } from '#src/drivers/common/types/Driver.ts';
import { isRateLimitMessage } from '#src/drivers/common/utils/isRateLimitMessage.ts';
import { spawnCollect } from '#src/drivers/common/utils/spawnCollect.ts';
import { writeSystemPromptFile } from '#src/drivers/common/utils/writeSystemPromptFile.ts';

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

const ResultEvent = ResultEnvelope.extend({
	type: z.literal('result'),
	usage: z
		.object({
			input_tokens: z.number().optional(),
			output_tokens: z.number().optional(),
			cache_read_input_tokens: z.number().optional(),
			cache_creation_input_tokens: z.number().optional(),
		})
		.optional(),
	total_cost_usd: z.number().optional(),
});

/** Fallback for non-stream output (`--output-format json`): the whole stdout is one envelope. */
const parseEnvelope = ({ stdout }: { stdout: string }) => {
	try {
		return ResultEnvelope.parse(JSON.parse(stdout));
	} catch {
		return undefined;
	}
};

/**
 * Driver for the Claude Code CLI in headless mode (`claude -p`).
 *
 * Spawns the user's own installed, logged-in `claude` binary — auth and
 * billing ride the user's existing session (e.g. a Max subscription), and the
 * engine never sees a credential. Stream-json event shapes verified against
 * claude CLI 2.1.200; `--append-system-prompt-file` and
 * `--exclude-dynamic-system-prompt-sections` verified against claude CLI
 * 2.1.218; `--effort` verified against claude CLI 2.1.221.
 */
export const createClaudeCodeDriver = (): Driver => {
	const driver: Driver = {
		name: 'claude-code',
		invoke: async (invocation) => {
			const { prompt, systemPrompt, model, effort, permissions, allowedCommands, cwd, timeoutMs, onEvent } = invocation;

			let resultEvent: z.infer<typeof ResultEvent> | undefined;

			const systemPromptFile = systemPrompt ? await writeSystemPromptFile({ systemPrompt }) : undefined;

			// The temp file outlives only the spawn — cleanup runs on the error
			// path too, and never throws.
			const { exitCode, stdout, stderr } = await spawnCollect({
				command: 'claude',
				args: buildClaudeCodeArgs({ systemPromptPath: systemPromptFile?.path, model, effort, permissions, allowedCommands }),
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
			}).finally(() => systemPromptFile?.cleanup());

			const envelope = resultEvent ?? parseEnvelope({ stdout });
			const text = envelope?.result ?? stdout ?? '';
			const errored = envelope?.is_error === true || exitCode !== 0;
			const usage =
				resultEvent && (resultEvent.usage || resultEvent.total_cost_usd !== undefined)
					? {
							inputTokens: resultEvent.usage?.input_tokens ?? 0,
							outputTokens: resultEvent.usage?.output_tokens ?? 0,
							cacheReadTokens: resultEvent.usage?.cache_read_input_tokens ?? 0,
							cacheCreationTokens: resultEvent.usage?.cache_creation_input_tokens ?? 0,
							costUsd: resultEvent.total_cost_usd ?? 0,
						}
					: undefined;

			return {
				text: text || stderr,
				exitCode,
				rateLimited: errored && isRateLimitMessage({ text: `${text}\n${stderr}` }),
				usage,
			};
		},
	};

	return driver;
};
