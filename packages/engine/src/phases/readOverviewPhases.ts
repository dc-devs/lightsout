interface Params {
	overviewContent: string;
}

/**
 * Phase file names from the overview's `## Phases` table, in written order.
 *
 * The table is the authored source of truth for phase order — sorting file
 * names would put `phase10` before `phase2`, which is exactly the ordering the
 * author did not write. Deterministic and dependency-free; the caller decides
 * whether an empty result is an error.
 */
export const readOverviewPhases = ({ overviewContent }: Params): string[] => {
	const files: string[] = [];
	let inPhases = false;

	for (const line of overviewContent.split(/\r?\n/)) {
		const heading = /^##\s+(.+?)\s*$/.exec(line);

		if (heading) {
			inPhases = heading[1] === 'Phases';

			continue;
		}

		if (!inPhases || !line.trim().startsWith('|')) {
			continue;
		}

		// The File column is the second data cell; the header row and the dash
		// divider carry no code span, so they fall out without a special case.
		const cells = line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|');
		const file = /`([^`]+)`/.exec(cells[1] ?? '')?.[1]?.trim();

		if (file) {
			files.push(file);
		}
	}

	return files;
};
