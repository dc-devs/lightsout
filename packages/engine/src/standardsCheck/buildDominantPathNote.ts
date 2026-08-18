import type { StandardsFinding } from '@/contracts';

/** Deepest directory (depth ≥ 2) holding >50% of findings — undefined when no directory that deep dominates, or the report is too small to diagnose. */
const findDominantPath = ({ findings }: { findings: StandardsFinding[] }) => {
	const paths = findings.map((finding) => finding.files[0]?.path).filter((path): path is string => path !== undefined);

	if (paths.length < 20) {
		return undefined;
	}

	let prefix = '';
	let count = paths.length;

	for (;;) {
		const children = new Map<string, number>();

		for (const path of paths) {
			if (prefix && !path.startsWith(`${prefix}/`)) {
				continue;
			}

			const segment = path.slice(prefix ? prefix.length + 1 : 0).split('/')[0];

			if (segment && !segment.includes('.')) {
				children.set(segment, (children.get(segment) ?? 0) + 1);
			}
		}

		const next = [...children.entries()].sort((a, b) => b[1] - a[1])[0];

		if (!next || next[1] / paths.length <= 0.5) {
			break;
		}

		prefix = prefix ? `${prefix}/${next[0]}` : next[0];
		count = next[1];
	}

	return prefix.split('/').length >= 2 ? { dir: prefix, count, total: paths.length } : undefined;
};

/**
 * The self-diagnosis note for a report dominated by one directory, or undefined
 * when the report has none to make. A report whose findings pile up under a
 * single deep path is usually a config gap rather than a code problem (live
 * case: a generated Prisma dir missing from `generated`), so the note names
 * both the directory and the config list that would exclude it.
 */
export const buildDominantPathNote = ({ findings }: { findings: StandardsFinding[] }): string | undefined => {
	const dominant = findDominantPath({ findings });

	return dominant === undefined
		? undefined
		: `${Math.round((dominant.count / dominant.total) * 100)}% of findings (${dominant.count}/${dominant.total}) sit under ${dominant.dir}/ — if that path is generated output, add it to the config's "generated" list`;
};
