import { z } from 'zod';
import { buildPiArgs, type PiVariant } from '#src/drivers/buildPiArgs.ts';
import type { Driver } from '#src/drivers/common/types/Driver.ts';
import { isRateLimitMessage } from '#src/drivers/common/utils/isRateLimitMessage.ts';
import { spawnCollect } from '#src/drivers/common/utils/spawnCollect.ts';
import { writeSystemPromptFile } from '#src/drivers/common/utils/writeSystemPromptFile.ts';

/**
 * One message of the pi-family json stream (`<binary> -p --mode json`): NDJSON,
 * one event per line. The final text and usage ride the last assistant message
 * of the terminal `agent_end` event; a `message_end` for an assistant message
 * is the fallback when the stream never reaches `agent_end`. Only what drives
 * the verdict is parsed — the raw events flow to `onEvent` untouched, usage and
 * cost included. Shapes verified against omp 18.1.6; the event vocabulary is
 * the one both binaries share (omp is a fork of pi and kept the session event
 * stream, `agent_start` through `agent_end`, intact).
 */
const Usage = z.object({
	input: z.number().optional(),
	output: z.number().optional(),
	cacheRead: z.number().optional(),
	cacheWrite: z.number().optional(),
	cost: z
		.object({
			total: z.number().optional(),
		})
		.optional(),
});

const ContentBlock = z.object({
	type: z.string(),
	text: z.string().optional(),
});

const Message = z.object({
	role: z.string(),
	content: z.array(ContentBlock).optional(),
	usage: Usage.optional(),
});

const MessageEndEvent = z.object({
	type: z.literal('message_end'),
	message: Message,
});

const AgentEndEvent = z.object({
	type: z.literal('agent_end'),
	messages: z.array(Message),
});

interface PiFamilyParams {
	name: string;
	variant: PiVariant;
	command: string;
}

/**
 * Driver for the pi family of coding agents in print mode (`pi -p` / `omp -p`).
 *
 * Spawns the user's own installed, logged-in binary — auth and billing ride
 * the user's existing session (an omp install, a pi install, whichever the
 * config names), and the engine never sees a credential. `omp` (Oh My Pi) is a
 * fork of pi that adds the plugin/skill layer and an approval system, so an
 * `omp` spawn runs with the user's whole omp setup; `pi` is bare upstream,
 * which has no permission system at all. The two share the print-mode flag
 * surface and the json event stream, which is why one implementation serves
 * both names.
 */
const createPiFamilyDriver = ({ name, variant, command }: PiFamilyParams): Driver => {
	const driver: Driver = {
		name,
		invoke: async (invocation) => {
			const { prompt, systemPrompt, model, effort, permissions, cwd, timeoutMs, onEvent } = invocation;

			let agentEnd: z.infer<typeof AgentEndEvent> | undefined;
			let lastAssistant: z.infer<typeof Message> | undefined;

			const systemPromptFile = systemPrompt ? await writeSystemPromptFile({ systemPrompt }) : undefined;

			// The temp file outlives only the spawn — cleanup runs on the error
			// path too, and never throws.
			const { exitCode, stdout, stderr } = await spawnCollect({
				command,
				args: buildPiArgs({ variant, systemPromptPath: systemPromptFile?.path, model, effort, permissions }),
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

					const messageEnd = MessageEndEvent.safeParse(event);

					if (messageEnd.success) {
						lastAssistant = messageEnd.data.message;
					}

					const end = AgentEndEvent.safeParse(event);

					if (end.success) {
						agentEnd = end.data;
					}

					onEvent?.(event);
				},
			}).finally(() => systemPromptFile?.cleanup());

			// agent_end is the record of the whole exchange: its last assistant
			// message is the final answer even when intermediate assistant
			// messages (tool-call rounds) came after the last message_end the
			// stream carried in full.
			const finalMessage = agentEnd ? [...agentEnd.messages].reverse().find((message) => message.role === 'assistant') : lastAssistant;
			// The answer is the final message's `text` blocks joined — thinking
			// and tool-call blocks are not prose.
			const text = (finalMessage?.content ?? [])
				.filter((block) => block.type === 'text')
				.map((block) => block.text ?? '')
				.join('\n');
			const errored = exitCode !== 0 || text === '';

			return {
				text: text || stdout || stderr,
				exitCode,
				rateLimited: errored && isRateLimitMessage({ text: `${stdout}\n${stderr}` }),
				usage: finalMessage?.usage
					? {
							inputTokens: finalMessage.usage.input ?? 0,
							outputTokens: finalMessage.usage.output ?? 0,
							cacheReadTokens: finalMessage.usage.cacheRead ?? 0,
							cacheCreationTokens: finalMessage.usage.cacheWrite ?? 0,
							costUsd: finalMessage.usage.cost?.total ?? 0,
						}
					: undefined,
			};
		},
	};

	return driver;
};

/** Driver for bare pi (@earendil-works/pi-coding-agent) — spawns the `pi` binary. */
export const createPiDriver = (): Driver => createPiFamilyDriver({ name: 'pi', variant: 'pi', command: 'pi' });

/** Driver for Oh My Pi — spawns the `omp` binary, plugins and all. */
export const createOmpDriver = (): Driver => createPiFamilyDriver({ name: 'omp', variant: 'omp', command: 'omp' });
