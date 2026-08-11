import { z } from 'zod';

/**
 * Normalized token/cost usage for one agent invocation, as reported by the
 * harness's result envelope. Drivers that report nothing omit it — the
 * engine records what it can prove and never estimates.
 */
export const AgentUsage = z.object({
	inputTokens: z.number(),
	outputTokens: z.number(),
	cacheReadTokens: z.number(),
	cacheCreationTokens: z.number(),
	costUsd: z.number(),
});

export type AgentUsage = z.infer<typeof AgentUsage>;
