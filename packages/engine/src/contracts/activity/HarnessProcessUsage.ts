import { z } from 'zod';

/**
 * What one harness process reported it spent.
 *
 * Every field is optional, which is the whole point. A process killed at its
 * ceiling has token counts from the messages it streamed and no cost — a
 * harness states a session cost only in a terminal result event a killed
 * process never reaches — so per field is the only granularity that can hold
 * that truth. An absent field means not reported and is rendered as such; a
 * present `0` is a real zero.
 *
 * It deliberately does not reuse `AgentUsage`, whose five fields are all
 * required and which drivers omit whole.
 */
export const HarnessProcessUsage = z.object({
	inputTokens: z.number().optional(),
	outputTokens: z.number().optional(),
	cacheReadTokens: z.number().optional(),
	cacheCreationTokens: z.number().optional(),
	/** Stored only when the harness stated it. Never computed from a price list. */
	costUsd: z.number().optional(),
});

export type HarnessProcessUsage = z.infer<typeof HarnessProcessUsage>;
