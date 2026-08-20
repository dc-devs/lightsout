import { z } from 'zod';
import { AgentUsage } from '#src/contracts/run/AgentUsage.ts';

/** Run-wide agent usage aggregate, summed across every invocation (fixes, re-emits, and the supervisor included). */
export const RunUsage = AgentUsage.extend({
	invocations: z.number(),
});

export type RunUsage = z.infer<typeof RunUsage>;
