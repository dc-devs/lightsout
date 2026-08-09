import type { RawStandardsFinding, StandardsCheckModule } from '@/contracts';
import { commonTypeFolders } from '../../../../common/constants/commonTypeFolders.ts';
import { buildRawFinding } from '../../../../common/utils/buildRawFinding.ts';
import { collectDirectories } from '../../../../common/utils/collectDirectories.ts';
import { getBaseName } from '../../../../common/utils/getBaseName.ts';
import { getDirectory } from '../../../../common/utils/getDirectory.ts';
import { isTestFile } from '../../../../common/utils/isTestFile.ts';
import { readPathLists } from '../../../../common/utils/readPathLists.ts';

/** Whether a folder is a graduated domain folder — directly under a `common/`, and not one of its four type folders. */
const isDomainFolder = ({ directory }: { directory: string }) =>
	getBaseName({ path: getDirectory({ path: directory }) }) === 'common' && !commonTypeFolders.has(getBaseName({ path: directory }));

export const check: StandardsCheckModule = {
	inputKind: 'file-list',
	// The always-built type-folder skeleton is never judged, and the test beside
	// a file does not make a second file.
	run: ({ input }): RawStandardsFinding[] => {
		const { files, standardsPackages } = readPathLists({ input });
		const productionFiles = files.filter((file) => !isTestFile({ path: file, standardsPackages }));

		return [...collectDirectories({ files })]
			.sort()
			.filter(
				(directory) =>
					isDomainFolder({ directory }) && productionFiles.filter((file) => getDirectory({ path: file }) === directory).length === 1,
			)
			.map((directory) =>
				buildRawFinding({
					rule: 'path-domain-folder-single-file',
					files: [{ path: directory }],
					detail: `domain folder '${getBaseName({ path: directory })}' holds one file`,
					guidance:
						'A domain folder graduates when a SECOND related function appears — until then the file belongs in `utils/`. Heuristic — judge before acting.',
				}),
			);
	},
};
