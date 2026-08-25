import type { RawStandardsFinding, StandardsCheckModule } from '@lightsout/standards-contracts';
import { readPathLists } from '../../../../common/checkInput/readPathLists.ts';
import { commonTypeFolders } from '../../../../common/constants/commonTypeFolders.ts';
import { buildRawFinding } from '../../../../common/findings/buildRawFinding.ts';
import { collectDirectories } from '../../../../common/paths/collectDirectories.ts';
import { getBaseName } from '../../../../common/paths/getBaseName.ts';
import { getDirectory } from '../../../../common/paths/getDirectory.ts';
import { isTestFile } from '../../../../common/paths/isTestFile.ts';

/** Whether a folder is a graduated domain folder — directly under a `common/`, and not one of its four type folders. */
const isDomainFolder = ({ directory }: { directory: string }) =>
	getBaseName({ path: getDirectory({ path: directory }) }) === 'common' && !commonTypeFolders.has(getBaseName({ path: directory }));

export const check: StandardsCheckModule = {
	inputKind: 'file-list',
	// The always-built type-folder skeleton is never judged, and the test beside
	// a file does not make a second file.
	run: ({ input }): RawStandardsFinding[] => {
		const { files, standardsPacks } = readPathLists({ input });
		const productionFiles = files.filter((file) => !isTestFile({ path: file, standardsPacks }));

		return [...collectDirectories({ files })]
			.sort()
			.filter((directory) => isDomainFolder({ directory }) && productionFiles.filter((file) => getDirectory({ path: file }) === directory).length === 1)
			.map((directory) =>
				buildRawFinding({
					rule: 'single-file-domain-folder',
					files: [{ path: directory }],
					detail: `domain folder '${getBaseName({ path: directory })}' holds one file`,
					guidance:
						'A domain folder graduates when a SECOND related function appears — until then the file belongs in `utils/`. Heuristic — judge before acting.',
				}),
			);
	},
};
