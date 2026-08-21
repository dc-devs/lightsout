import type { RawStandardsFinding, StandardsCheckModule } from '@lightsout/standards-contracts';
import { readPathLists } from '../../../../common/checkInput/readPathLists.ts';
import { commonTypeFolders } from '../../../../common/constants/commonTypeFolders.ts';
import { buildRawFinding } from '../../../../common/findings/buildRawFinding.ts';
import { getFrameworkCarveOuts } from '../../../../common/frameworks/getFrameworkCarveOuts.ts';
import { getPathCarveOut } from '../../../../common/frameworks/getPathCarveOut.ts';
import { getSourceRoot } from '../../../../common/frameworks/getSourceRoot.ts';
import { collectDirectories } from '../../../../common/paths/collectDirectories.ts';
import { getBaseName } from '../../../../common/paths/getBaseName.ts';

/**
 * The banned list's upper tier: a folder is never named for the ROLE of the
 * code it holds. These nine are wrong at every level, so `helpers/`, `lib/` and
 * `core/` can never come back as the place for whatever had no home — the
 * failure mode a closed list exists to prevent.
 */
const bannedAnywhere = new Set(['helpers', 'lib', 'core', 'misc', 'shared', 'controllers', 'models', 'hooks', 'components']);

export const check: StandardsCheckModule = {
	inputKind: 'file-list',
	// Carries the doc's framework carve-out, because the doc does: `components/`
	// is banned as a module name and mandated by React. A rule that ignored the
	// carve-out would flood the work-list, and a flooded work-list is how a
	// refactor agent starts declining batches.
	run: ({ input }): RawStandardsFinding[] => {
		const { files } = readPathLists({ input });
		const carveOuts = getFrameworkCarveOuts({ dependencies: input.kind === 'file-list' ? input.dependencies : new Map<string, string[]>() });
		const findings: RawStandardsFinding[] = [];

		for (const directory of [...collectDirectories({ files })].sort()) {
			const carveOut = getPathCarveOut({ carveOuts, path: directory });

			if (!directory.startsWith(getSourceRoot({ carveOut }))) {
				continue;
			}

			const name = getBaseName({ path: directory });
			const insideCommon = directory.split('/').slice(0, -1).includes('common');
			const banned = bannedAnywhere.has(name) || (commonTypeFolders.has(name) && !insideCommon);

			if (banned && !carveOut.exemptFolderNames.includes(name)) {
				findings.push(
					buildRawFinding({
						rule: 'path-banned-module-name',
						files: [{ path: directory }],
						detail: `folder '${name}' names the role of the code it holds`,
						guidance:
							'Name the folder for the domain it serves, or fold its files into the module that owns them — the only privileged folder name at any level is `common/`.',
					}),
				);
			}
		}

		return findings;
	},
};
