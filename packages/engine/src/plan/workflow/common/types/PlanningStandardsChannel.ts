import type { PlanningVocabulary } from '#src/contracts/index.ts';

/** Exact resolved channel text; serialization belongs to the planning coordinator. */
export interface PlanningStandardsChannel {
	channel: (typeof PlanningVocabulary.Channel)[keyof typeof PlanningVocabulary.Channel];
	sourceIdentity: string;
	policyDigest: string;
	text: string;
	sha256: string;
}
