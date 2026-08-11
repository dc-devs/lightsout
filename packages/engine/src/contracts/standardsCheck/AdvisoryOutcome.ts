import { z } from 'zod';
import { AdvisoryResponse } from '@/contracts/standardsCheck/AdvisoryResponse';

/**
 * One advisory finding's fate, as the agent that was shown it reports.
 *
 * An account, never a gate: a missing or partial list is data the health
 * report does not have, not a failure of the work that produced it.
 */
export const AdvisoryOutcome = z.object({
	/** The rule id, echoed from the finding as it was given. */
	rule: z.string(),
	/** The finding's site key, echoed from the finding as it was given. */
	siteKey: z.string(),
	outcome: z.enum(AdvisoryResponse),
	/** Why the advice was declined — the sentence the health report prints under the rule. */
	reason: z.string().optional(),
});

export type AdvisoryOutcome = z.infer<typeof AdvisoryOutcome>;
