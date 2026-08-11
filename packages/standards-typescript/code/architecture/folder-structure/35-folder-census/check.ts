import type { RawStandardsFinding, StandardsCheckModule } from '@lightsout/standards-contracts';
import { buildRawFinding } from '../../../../common/utils/buildRawFinding.ts';
import { getDirectory } from '../../../../common/utils/getDirectory.ts';
import { readPathLists } from '../../../../common/utils/readPathLists.ts';

export const check: StandardsCheckModule = {
	inputKind: 'file-list',
	// Counts production files only — a test beside its subject is the convention
	// working, so counting it would push a folder over the cap for obeying a
	// different rule. Every other file counts, barrels included: the census asks
	// how long the directory listing has grown, and a barrel is a line in it.
	run: ({ input, settings }): RawStandardsFinding[] => {
		const { files, tests } = readPathLists({ input });
		const testPaths = new Set(tests);
		const filesPerDirectory = new Map<string, string[]>();
		const { cap } = settings;

		for (const file of files) {
			if (!testPaths.has(file)) {
				const directory = getDirectory({ path: file });

				filesPerDirectory.set(directory, [...(filesPerDirectory.get(directory) ?? []), file]);
			}
		}

		return [...filesPerDirectory]
			.filter(([, paths]) => paths.length > cap)
			.map(([directory, paths]) =>
				buildRawFinding({
					rule: 'folder-census',
					files: [{ path: directory }],
					detail: `${paths.length} files in one flat folder (census cap ~${cap})`,
					guidance: 'Group them by domain, or graduate the concepts hiding in the pile.',
				}),
			);
	},
};
