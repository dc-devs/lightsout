import { z } from 'zod';
import type { AgentHeartbeat } from '#src/standardsCheck/common/types/AgentHeartbeat.ts';
import { formatElapsed } from '#src/standardsCheck/common/utils/formatElapsed.ts';

/**
 * The slice of a Claude Code stream-json `assistant` event the heartbeat reads:
 * each `tool_use` content block is one tool call. Anything else is still
 * activity — the harness is alive — but not a tool call. Parse, don't cast.
 */
const AssistantEvent = z.object({
	type: z.literal('assistant'),
	message: z.object({ content: z.array(z.object({ type: z.string() })) }),
});

interface Params {
	onProgress: (message: string) => void;
	/** Gap between lines while the agent runs. */
	intervalMs?: number;
}

const countToolCalls = ({ event }: { event: unknown }) => {
	const parsed = AssistantEvent.safeParse(event);

	return parsed.success ? parsed.data.message.content.filter((block) => block.type === 'tool_use').length : 0;
};

/**
 * A line every interval while one agent invocation runs, so a reader waiting on
 * a long review can tell "still working" from "hung". Each line carries the
 * elapsed time and, when the harness streams events, the tool calls made so
 * far — the evidence that the agent is reading, not stalled. A harness with no
 * event stream (Codex) still gets the elapsed line. The lines carry no prefix:
 * the caller knows what the agent is doing and adds the context its own output
 * needs.
 *
 * The ticker is unref'd so it never holds the process open, and `stop` clears
 * it — callers stop in a `finally`, so a throwing invocation leaves no timer.
 */
export const createAgentHeartbeat = ({ onProgress, intervalMs = 30_000 }: Params): AgentHeartbeat => {
	const startedAt = Date.now();
	let stoppedAt: number | undefined;
	let toolCalls = 0;
	let eventsSeen = false;

	const tick = () => {
		const elapsed = formatElapsed({ elapsedMs: Date.now() - startedAt });
		const activity = eventsSeen ? ` · ${toolCalls} tool call(s) so far` : '';

		onProgress(`still working — ${elapsed} elapsed${activity}`);
	};

	const timer = setInterval(tick, intervalMs);

	timer.unref();

	return {
		onEvent: (event) => {
			eventsSeen = true;
			toolCalls += countToolCalls({ event });
		},
		stop: () => {
			clearInterval(timer);
			stoppedAt ??= Date.now();
		},
		elapsedMs: () => (stoppedAt ?? Date.now()) - startedAt,
	};
};
