import { z } from 'zod';
import { formatElapsed } from '#src/common/utils/formatElapsed.ts';
import type { AgentHeartbeat } from '#src/standardsCheck/common/types/AgentHeartbeat.ts';

/**
 * The slice of a Claude Code stream-json `assistant` event the heartbeat
 * reads: each `tool_use` block names its tool, and a `Read` carries the file it
 * opened. Anything else is still activity — the harness is alive — but not a
 * file read. Parse, don't cast.
 */
const AssistantEvent = z.object({
	type: z.literal('assistant'),
	message: z.object({
		content: z.array(z.object({ type: z.string(), name: z.string().optional(), input: z.object({ file_path: z.string().optional() }).optional() })),
	}),
});

interface Params {
	/** What the agent is doing, as the reader knows it — `agent review`. Opens every line so it stands on its own in any log. */
	label: string;
	onProgress: (message: string) => void;
	/** Gap between lines while the agent runs. */
	intervalMs?: number;
}

const readPathsOf = ({ event }: { event: unknown }) => {
	const parsed = AssistantEvent.safeParse(event);

	if (!parsed.success) {
		return [];
	}

	return parsed.data.message.content.flatMap((block) =>
		block.type === 'tool_use' && block.name === 'Read' && block.input?.file_path ? [block.input.file_path] : [],
	);
};

/**
 * A line every interval while one agent invocation runs, so a reader waiting on
 * a long review can tell "still working" from "hung". Each line says the agent
 * is still running, for how long, and — when the harness streams its events —
 * how many files it has read so far: proof of life in words the reader owns,
 * not harness internals. A harness with no event stream (Codex) still gets the
 * elapsed line.
 *
 * The ticker is unref'd so it never holds the process open, and `stop` clears
 * it — callers stop in a `finally`, so a throwing invocation leaves no timer.
 */
export const createAgentHeartbeat = ({ label, onProgress, intervalMs = 30_000 }: Params): AgentHeartbeat => {
	const startedAt = Date.now();
	const filesRead = new Set<string>();
	let stoppedAt: number | undefined;

	const tick = () => {
		const elapsed = formatElapsed({ elapsedMs: Date.now() - startedAt });
		const activity = filesRead.size === 0 ? '' : ` · ${filesRead.size} file${filesRead.size === 1 ? '' : 's'} read so far`;

		onProgress(`⏳ ${label} still running · ${elapsed}${activity}`);
	};

	const timer = setInterval(tick, intervalMs);

	timer.unref();

	return {
		onEvent: (event) => {
			for (const path of readPathsOf({ event })) {
				filesRead.add(path);
			}
		},
		stop: () => {
			clearInterval(timer);
			stoppedAt ??= Date.now();
		},
		elapsedMs: () => (stoppedAt ?? Date.now()) - startedAt,
	};
};
