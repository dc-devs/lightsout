/**
 * How a detected prior-art duplication is resolved in the Dedup Review pass —
 * the menu the judge recommends from and the human chooses. Values are internal
 * to findings reports and the Decision-Log rows the review writes.
 */
export const DedupResolution = {
	Reuse: 'reuse',
	Extend: 'extend',
	Extract: 'extract',
	Defer: 'defer',
	Distinct: 'distinct',
} as const;

export type DedupResolution = (typeof DedupResolution)[keyof typeof DedupResolution];
