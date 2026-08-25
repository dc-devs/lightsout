import type { RawStandardsFinding, StandardsCheckModule } from '@lightsout/standards-contracts';
import { readPathLists } from '../../../../common/checkInput/readPathLists.ts';
import { buildRawFinding } from '../../../../common/findings/buildRawFinding.ts';
import { getFrameworkCarveOuts } from '../../../../common/frameworks/getFrameworkCarveOuts.ts';
import { getPathCarveOut } from '../../../../common/frameworks/getPathCarveOut.ts';
import { getSourceRoot } from '../../../../common/frameworks/getSourceRoot.ts';
import { collectDirectories } from '../../../../common/paths/collectDirectories.ts';
import { getBaseName } from '../../../../common/paths/getBaseName.ts';

/**
 * Folders that are junk drawers by name at every level — the place code lands
 * when nobody decided where it belongs. Banned even inside `common/`.
 *
 * Framework vocabulary (`components/`, `hooks/`, `services/`, `controllers/`,
 * `models/`) is deliberately NOT here: those names are how React and NestJS
 * projects are actually organised, and banning them cost an un-banning layer
 * of per-framework exceptions that outweighed the rule.
 */
const bannedAnywhere = new Set(['helpers', 'lib', 'core', 'misc', 'shared']);

/**
 * Kind-buckets with a sanctioned home: `common/utils/`, `common/types/` and
 * `common/constants/` are the mandated skeleton, so the same names outside a
 * `common/` mean files sorted by kind instead of by domain.
 */
const bannedOutsideCommon = new Set(['utils', 'types', 'constants']);

export const check: StandardsCheckModule = {
	inputKind: 'file-list',
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
			const banned = bannedAnywhere.has(name) || (bannedOutsideCommon.has(name) && !insideCommon);

			if (banned) {
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
