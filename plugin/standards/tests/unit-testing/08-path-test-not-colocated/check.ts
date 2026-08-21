import type { RawStandardsFinding, StandardsCheckModule } from '@lightsout/standards-contracts';
import { readPathLists } from '../../../common/checkInput/readPathLists.ts';
import { buildRawFinding } from '../../../common/findings/buildRawFinding.ts';
import { getDirectory } from '../../../common/paths/getDirectory.ts';
import { getTestSubject } from '../../../common/paths/getTestSubject.ts';
import { getTestSubjectName } from '../../../common/paths/getTestSubjectName.ts';
import { isUnderSrc } from '../../../common/paths/isUnderSrc.ts';

export const check: StandardsCheckModule = {
	inputKind: 'file-list',
	// Anchored to `src/`: a package's own `tests/` directory is a sanctioned
	// test-support location whose files name no subject beside them.
	run: ({ input }): RawStandardsFinding[] => {
		const { files, tests } = readPathLists({ input });
		const fileSet = new Set(files);
		const orphaned = tests.filter((test) => isUnderSrc({ path: test }) && getTestSubject({ test, files: fileSet }) === undefined);

		return orphaned.map((test) =>
			buildRawFinding({
				rule: 'path-test-not-colocated',
				files: [{ path: test }],
				detail: `no source file named '${getTestSubjectName({ test })}' in ${getDirectory({ path: test })}`,
				guidance:
					'The first name segment must name a real source file in the same folder; a scenario suite qualifies it as `<File>.<scenario>.unit.test.ts` with a camelCase qualifier.',
			}),
		);
	},
};
