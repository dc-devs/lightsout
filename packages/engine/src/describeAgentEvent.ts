import { z } from 'zod';

const ToolUseBlock = z.object({
	type: z.literal('tool_use'),
	name: z.string(),
	input: z.record(z.string(), z.unknown()).optional(),
});

const AssistantEvent = z.object({
	type: z.literal('assistant'),
	message: z.object({ content: z.array(z.unknown()) }),
});

interface Params {
	event: unknown;
}

/**
 * One human-readable line for a harness stream event worth narrating — tool
 * calls with their target (file path, command, pattern) — or undefined for
 * everything else (thinking, token ticks, text deltas: noise in a progress
 * stream). Display only; never drives engine decisions.
 */
export const describeAgentEvent = ({ event }: Params) => {
	const assistant = AssistantEvent.safeParse(event);

	if (!assistant.success) {
		return undefined;
	}

	for (const block of assistant.data.message.content) {
		const tool = ToolUseBlock.safeParse(block);

		if (!tool.success) {
			continue;
		}

		const input = tool.data.input ?? {};
		const target = [input.file_path, input.path, input.command, input.pattern, input.prompt].find(
			(value) => typeof value === 'string',
		);

		return `${tool.data.name}${target ? `: ${String(target).replace(/\s+/g, ' ').slice(0, 90)}` : ''}`;
	}

	return undefined;
};
