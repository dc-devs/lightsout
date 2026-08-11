import { z } from 'zod';
import { AgentUsage } from '@/contracts/run/AgentUsage';

/** Run-wide agent usage aggregate, summed across every invocation (fixes, re-emits, and the supervisor included). */
export const RunUsage = AgentUsage.extend({
	invocations: z.number(),
});

export type RunUsage = z.infer<typeof RunUsage>;
