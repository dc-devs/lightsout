import { z } from 'zod';
import { buildPiArgs, type PiVariant } from '#src/drivers/buildPiArgs.ts';
import type { Driver } from '#src/drivers/common/types/Driver.ts';
import type { DriverResult } from '#src/drivers/common/types/DriverResult.ts';
import { isRateLimitMessage } from '#src/drivers/internal/common/utils/isRateLimitMessage.ts';
import { spawnCollect } from '#src/drivers/internal/common/utils/spawnCollect.ts';
import { writeSystemPromptFile } from '#src/drivers/internal/common/utils/writeSystemPromptFile.ts';

/**
 * One message of the pi-family json stream (`<binary> -p --mode json`): NDJSON,
 * one event per line. The final text rides the last assistant message of the
 * terminal `agent_end` event; a `message_end` for an assistant message is the
 * fallback when the stream never reaches `agent_end`. Usage is stated per
 * assistant message, so a process's spend is its messages added up. Only what drives
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

// Loose, so a parsed message keeps every field the stream gave it: the whole
// message is what tells one assistant turn from another when the tally has to
// decide whether it has already counted this one.
const ContentBlock = z.looseObject({
	type: z.string(),
	text: z.string().optional(),
});

const Message = z.looseObject({
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

/**
 * Adds up what one process spent, assistant message by assistant message, and
 * answers the running total whenever a message it had not already counted
 * lands.
 *
 * This harness states its counts per message, not per session — the captured
 * omp transcript shows one turn's `cost.total` equal to that same turn's own
 * input, output and cache prices added up — so a whole process's spend is its
 * messages added up, and the last message's counts alone would under-report
 * every multi-turn agent. Each message reaches the reader twice, once as its
 * own `message_end` and again inside the terminal `agent_end` list, so the
 * message as the stream gave it is the key that counts it once.
 */
const createSessionUsageTally = () => {
	const counted = new Set<string>();
	const total = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 0, costUsd: 0 };

	return ({ messages }: { messages: z.infer<typeof Message>[] }) => {
		let added = false;

		for (const message of messages) {
			const key = JSON.stringify(message);

			if (message.role !== 'assistant' || !message.usage || counted.has(key)) {
				continue;
			}

			counted.add(key);
			added = true;
			total.inputTokens += message.usage.input ?? 0;
			total.outputTokens += message.usage.output ?? 0;
			total.cacheReadTokens += message.usage.cacheRead ?? 0;
			total.cacheCreationTokens += message.usage.cacheWrite ?? 0;
			total.costUsd += message.usage.cost?.total ?? 0;
		}

		return added ? { ...total } : undefined;
	};
};

/**
 * The answer this process produced.
 *
 * `agent_end` is the record of the whole exchange: its last assistant message
 * is the final answer even when intermediate assistant messages (tool-call
 * rounds) came after the last `message_end` the stream carried in full. The
 * answer is that message's `text` blocks joined — thinking and tool-call blocks
 * are not prose.
 */
const readFinalText = ({ agentEnd, lastAssistant }: { agentEnd?: z.infer<typeof AgentEndEvent>; lastAssistant?: z.infer<typeof Message> }) => {
	const finalMessage = agentEnd ? [...agentEnd.messages].reverse().find((message) => message.role === 'assistant') : lastAssistant;

	return (finalMessage?.content ?? [])
		.filter((block) => block.type === 'text')
		.map((block) => block.text ?? '')
		.join('\n');
};

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
			const { prompt, systemPrompt, model, effort, permissions, cwd, timeoutMs, onEvent, onUsage } = invocation;

			let agentEnd: z.infer<typeof AgentEndEvent> | undefined;
			let lastAssistant: z.infer<typeof Message> | undefined;
			let usage: DriverResult['usage'];
			const tallySessionUsage = createSessionUsageTally();

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

					// Per message as each one closes, so a process killed before
					// agent_end still accounts for what it spent.
					const streamed = tallySessionUsage({ messages: messageEnd.success ? [messageEnd.data.message] : end.success ? end.data.messages : [] });

					if (streamed) {
						usage = streamed;
						onUsage?.(streamed);
					}

					onEvent?.(event);
				},
			}).finally(() => systemPromptFile?.cleanup());

			const text = readFinalText({ agentEnd, lastAssistant });
			const errored = exitCode !== 0 || text === '';

			return {
				text: text || stdout || stderr,
				exitCode,
				rateLimited: errored && isRateLimitMessage({ text: `${stdout}\n${stderr}` }),
				// The session's own spend, not the final message's: this harness
				// counts per message, so the last one alone under-reports every
				// multi-turn agent.
				usage,
			};
		},
	};

	return driver;
};

/** Driver for bare pi (@earendil-works/pi-coding-agent) — spawns the `pi` binary. */
export const createPiDriver = (): Driver => createPiFamilyDriver({ name: 'pi', variant: 'pi', command: 'pi' });

/** Driver for Oh My Pi — spawns the `omp` binary, plugins and all. */
export const createOmpDriver = (): Driver => createPiFamilyDriver({ name: 'omp', variant: 'omp', command: 'omp' });
