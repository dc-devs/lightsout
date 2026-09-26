interface Params {
	findings: Array<{ rule: string }>;
}

/** Finding counts per rule — the burn-down's unit of comparison. */
export const countByRule = ({ findings }: Params): Record<string, number> => {
	const counts: Record<string, number> = {};

	for (const finding of findings) {
		counts[finding.rule] = (counts[finding.rule] ?? 0) + 1;
	}

	return counts;
};
