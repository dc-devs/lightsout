import type { RawStandardsFinding, StandardsCheckModule } from '@/contracts';
import { buildRawFinding } from '../../../common/utils/buildRawFinding.ts';
import { getDirectory } from '../../../common/utils/getDirectory.ts';
import { isUnderSrc } from '../../../common/utils/isUnderSrc.ts';
import { readPathLists } from '../../../common/utils/readPathLists.ts';

/**
 * The separate-directory names the rule refuses for a unit test. Outside `src/`
 * these very names are the sanctioned test-support locations the same document
 * names, which is why the rule is anchored to `src/`.
 */
const testDirectories = new Set(['__tests__', 'tests', 'test']);

const isSeparated = ({ test }: { test: string }) =>
	isUnderSrc({ path: test }) &&
	getDirectory({ path: test })
		.split('/')
		.some((segment) => testDirectories.has(segment));

export const check: StandardsCheckModule = {
	inputKind: 'file-list',
	run: ({ input }): RawStandardsFinding[] =>
		readPathLists({ input })
			.tests.filter((test) => isSeparated({ test }))
			.map((test) =>
				buildRawFinding({
					rule: 'path-test-in-tests-folder',
					files: [{ path: test }],
					detail: `a unit test in ${getDirectory({ path: test })}`,
					guidance: 'Unit tests are co-located with the file they test — move it beside its subject rather than into a separate directory.',
				}),
			),
};
