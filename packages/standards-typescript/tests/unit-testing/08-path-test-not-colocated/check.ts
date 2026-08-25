import type { RawStandardsFinding, StandardsCheckModule } from '@lightsout/standards-contracts';
import { readPathLists } from '../../../common/checkInput/readPathLists.ts';
import { buildRawFinding } from '../../../common/findings/buildRawFinding.ts';
import { getFrameworkCarveOuts } from '../../../common/frameworks/getFrameworkCarveOuts.ts';
import { getPathCarveOut } from '../../../common/frameworks/getPathCarveOut.ts';
import { getDirectory } from '../../../common/paths/getDirectory.ts';
import { getTestSubject } from '../../../common/paths/getTestSubject.ts';
import { getTestSubjectName } from '../../../common/paths/getTestSubjectName.ts';
import { isUnderSrc } from '../../../common/paths/isUnderSrc.ts';

export const check: StandardsCheckModule = {
	inputKind: 'file-list',
	// Anchored to `src/`: a package's own `tests/` directory is a sanctioned
	// test-support location whose files name no subject beside them.
	//
	// Each test's carve-out is looked up once and carried to both the lookup and
	// the detail, since a finding that named a subject the lookup never searched
	// for would send an author after a file the rule was not asking about.
	run: ({ input }): RawStandardsFinding[] => {
		const { files, tests } = readPathLists({ input });
		const carveOuts = getFrameworkCarveOuts({ dependencies: input.kind === 'file-list' ? input.dependencies : new Map<string, string[]>() });
		const fileSet = new Set(files);
		const orphaned = tests
			.filter((test) => isUnderSrc({ path: test }))
			.map((test) => ({ test, carveOut: getPathCarveOut({ carveOuts, path: test }) }))
			.filter(({ test, carveOut }) => getTestSubject({ test, files: fileSet, carveOut }) === undefined);

		return orphaned.map(({ test, carveOut }) =>
			buildRawFinding({
				rule: 'path-test-not-colocated',
				files: [{ path: test }],
				detail: `no source file named '${getTestSubjectName({ test, carveOut })}' in ${getDirectory({ path: test })}`,
				guidance:
					'The first name segment must name a real source file in the same folder; a scenario suite qualifies it as `<File>.<scenario>.unit.test.ts` with a camelCase qualifier.',
			}),
		);
	},
};
