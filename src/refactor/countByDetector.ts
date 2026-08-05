interface Params {
	findings: Array<{ detector: string }>;
}

/** Finding counts per detector — the burn-down's unit of comparison. */
export const countByDetector = ({ findings }: Params): Record<string, number> => {
	const counts: Record<string, number> = {};

	for (const finding of findings) {
		counts[finding.detector] = (counts[finding.detector] ?? 0) + 1;
	}

	return counts;
};
