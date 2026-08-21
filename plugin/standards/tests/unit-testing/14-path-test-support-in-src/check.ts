import type { RawStandardsFinding, StandardsCheckModule } from '@lightsout/standards-contracts';
import { readPathLists } from '../../../common/checkInput/readPathLists.ts';
import { buildRawFinding } from '../../../common/findings/buildRawFinding.ts';
import { collectDirectories } from '../../../common/paths/collectDirectories.ts';
import { getBaseName } from '../../../common/paths/getBaseName.ts';
import { isUnderSrc } from '../../../common/paths/isUnderSrc.ts';

/**
 * The shared test-support folders the rule places outside `src/`. `__mocks__`
 * is deliberately absent — the same prose sanctions a co-located one — and so
 * is `helpers`, which the banned-module-name rule already owns, so one
 * misplaced folder never reports twice.
 */
const testSupportDirectories = new Set(['fixtures', 'mocks', 'testUtils', 'test-utils']);

export const check: StandardsCheckModule = {
	inputKind: 'file-list',
	// One finding per folder rather than per file: the folder is what moves.
	run: ({ input }): RawStandardsFinding[] =>
		[...collectDirectories({ files: readPathLists({ input }).files })]
			.filter((directory) => testSupportDirectories.has(getBaseName({ path: directory })) && isUnderSrc({ path: directory }))
			.sort()
			.map((directory) =>
				buildRawFinding({
					rule: 'path-test-support-in-src',
					files: [{ path: directory }],
					detail: `test-support folder '${getBaseName({ path: directory })}' under src/`,
					guidance:
						"Shared helpers, mocks and fixtures live in the package's test-support directories outside `src/` — under `src/` they read as production source to scanners and humans alike. A co-located `__mocks__/` is the one exception.",
				}),
			),
};
