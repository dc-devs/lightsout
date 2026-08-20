import { z } from 'zod';
import { Effort } from '#src/contracts/Effort.ts';
import { AgentUsage } from '#src/contracts/run/index.ts';

/** One `agents.jsonl` line: an invocation's usage plus who ran, when, and for which step. */
export const AgentInvocation = AgentUsage.extend({
	at: z.string(),
	/** Pipeline step the invocation served; supervisor consultations are suffixed '-supervisor'. */
	step: z.string(),
	model: z.string().optional(),
	effort: z.enum(Effort).optional(),
});

export type AgentInvocation = z.infer<typeof AgentInvocation>;
