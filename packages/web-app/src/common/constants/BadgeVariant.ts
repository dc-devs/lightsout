/**
 * The closed set of badge colour families, so the badge, the run-status table
 * and the severity badges all name the same thing rather than retyping a
 * literal each.
 *
 * The five status families and `neutral` colour run state; `blocking` and
 * `advisory` colour a standards finding's severity; `brand` is the one variant
 * allowed to carry the brand gradient.
 */
export const BadgeVariant = {
	Neutral: 'neutral',
	Running: 'running',
	Passed: 'passed',
	Failed: 'failed',
	Paused: 'paused',
	Escalated: 'escalated',
	Blocking: 'blocking',
	Advisory: 'advisory',
	Brand: 'brand',
} as const;

export type BadgeVariant = (typeof BadgeVariant)[keyof typeof BadgeVariant];
