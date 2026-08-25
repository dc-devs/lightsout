import type { RawStandardsFinding, StandardsCheckModule } from '@lightsout/standards-contracts';
import { readPathLists } from '../../../../common/checkInput/readPathLists.ts';
import { buildRawFinding } from '../../../../common/findings/buildRawFinding.ts';
import { getBaseName } from '../../../../common/paths/getBaseName.ts';
import { getDirectory } from '../../../../common/paths/getDirectory.ts';
import { isBarrelFile } from '../../../../common/paths/isBarrelFile.ts';

export const check: StandardsCheckModule = {
	inputKind: 'file-list',
	// A barrel sitting directly in `common/` is `path-common-barrel`'s to report
	// and no one else's, so it is excluded here rather than counted twice: one
	// wrong file is one finding.
	run: ({ input }): RawStandardsFinding[] =>
		readPathLists({ input })
			.files.filter((file) => {
				const parent = getDirectory({ path: file });

				return getBaseName({ path: parent }) === 'common' && !isBarrelFile({ path: file });
			})
			.map((file) =>
				buildRawFinding({
					rule: 'path-common-flat',
					files: [{ path: file }],
					detail: `'${getBaseName({ path: file })}' sits directly in ${getDirectory({ path: file })}`,
					guidance:
						'Move it under the type folder for what it is — `utils/`, `types/`, `constants/`, `services/`, or a graduated domain folder. `common/` is always typed, never flat.',
				}),
			),
};
