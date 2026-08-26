import type { RawStandardsFinding, StandardsCheckModule } from '@lightsout/standards-contracts';
import { readPathLists } from '../../../../common/checkInput/readPathLists.ts';
import { buildRawFinding } from '../../../../common/findings/buildRawFinding.ts';
import { getExportName } from '../../../../common/naming/getExportName.ts';

/**
 * Files in scope grouped by the export name their path implies, tests left out
 * — a test file is named after the subject it covers, so two of them under one
 * name is the convention working, not a concept implemented twice.
 */
const groupByName = ({ files, tests }: { files: string[]; tests: string[] }) => {
	const testPaths = new Set(tests);
	const byName = new Map<string, string[]>();

	for (const file of files) {
		const name = getExportName({ path: file });

		// Every folder-module has an index, so the name says nothing about what
		// the file holds.
		if (!testPaths.has(file) && name !== 'index') {
			byName.set(name, [...(byName.get(name) ?? []), file]);
		}
	}

	return byName;
};

export const check: StandardsCheckModule = {
	inputKind: 'file-list',
	// Tier 0 of the duplication ladder: one export per file makes a filename an
	// export name, so name-level comparison is nearly free and runs before any
	// file is opened. Advisory, because same-name siblings can be legitimate —
	// per-package analogs of one concept.
	run: ({ input }): RawStandardsFinding[] => {
		const { files, tests } = readPathLists({ input });

		return [...groupByName({ files, tests })]
			.filter(([, paths]) => paths.length > 1)
			.map(([name, paths]) =>
				buildRawFinding({
					rule: 'duplicate-export-name',
					files: paths.map((path) => ({ path })),
					detail: `'${name}' is declared in ${paths.length} places`,
					guidance: 'One concept implemented twice, or a promotion candidate.',
				}),
			);
	},
};
