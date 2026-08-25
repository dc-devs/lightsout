import type { RawStandardsFinding, StandardsCheckModule } from '@lightsout/standards-contracts';
import { readPathLists } from '../../../../common/checkInput/readPathLists.ts';
import { buildRawFinding } from '../../../../common/findings/buildRawFinding.ts';
import { getFrameworkCarveOuts } from '../../../../common/frameworks/getFrameworkCarveOuts.ts';
import { getPathCarveOut } from '../../../../common/frameworks/getPathCarveOut.ts';
import { isFrameworkLoadedFile } from '../../../../common/frameworks/isFrameworkLoadedFile.ts';
import { getDirectory } from '../../../../common/paths/getDirectory.ts';

export const check: StandardsCheckModule = {
	inputKind: 'file-list',
	// Counts production files only — a test beside its subject is the convention
	// working, so counting it would push a folder over the cap for obeying a
	// different rule. Every other file counts, barrels included: the question is
	// how long the directory listing has grown, and a barrel is a line in it.
	//
	// A file the package's framework put there is not counted at all — a route
	// file, or an entry file the framework resolves by name. A router root's
	// population is the number of routes the app has, and consolidating it is not
	// an edit any author is allowed to make; an entry file beside a package's
	// source is not the author's listing growing either.
	run: ({ input, settings }): RawStandardsFinding[] => {
		const { files, tests } = readPathLists({ input });
		const carveOuts = getFrameworkCarveOuts({ dependencies: input.kind === 'file-list' ? input.dependencies : new Map<string, string[]>() });
		const testPaths = new Set(tests);
		const filesPerDirectory = new Map<string, string[]>();
		const { cap } = settings;

		for (const file of files) {
			if (!testPaths.has(file)) {
				// Skipped file by file rather than filtered off the finished map, so a
				// router root holding two hundred route files contributes no group at
				// all rather than one that is dropped later.
				if (isFrameworkLoadedFile({ path: file, carveOut: getPathCarveOut({ carveOuts, path: file }) })) {
					continue;
				}

				const directory = getDirectory({ path: file });

				filesPerDirectory.set(directory, [...(filesPerDirectory.get(directory) ?? []), file]);
			}
		}

		return [...filesPerDirectory]
			.filter(([, paths]) => paths.length > cap)
			.map(([directory, paths]) =>
				buildRawFinding({
					rule: 'crowded-folder',
					files: [{ path: directory }],
					detail: `${paths.length} files in one flat folder (cap ~${cap})`,
					guidance: 'Group them by domain, or graduate the concepts hiding in the pile.',
				}),
			);
	},
};
