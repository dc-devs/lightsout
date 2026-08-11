import type { RawStandardsFinding, StandardsCheckModule } from '@lightsout/standards-contracts';
import { buildRawFinding } from '../../../../common/utils/buildRawFinding.ts';
import { getBaseName } from '../../../../common/utils/getBaseName.ts';
import { getDirectory } from '../../../../common/utils/getDirectory.ts';
import { readPathLists } from '../../../../common/utils/readPathLists.ts';

/** A barrel in any source dialect — this rule runs at full strength on JS-only repos. */
const barrelName = /^index\.(m|c)?[jt]sx?$/;

export const check: StandardsCheckModule = {
	inputKind: 'file-list',
	// A barrel sitting directly in `common/` is `path-common-barrel`'s to report
	// and no one else's, so it is excluded here rather than counted twice: one
	// wrong file is one finding.
	run: ({ input }): RawStandardsFinding[] =>
		readPathLists({ input })
			.files.filter((file) => {
				const parent = getDirectory({ path: file });

				return getBaseName({ path: parent }) === 'common' && !barrelName.test(getBaseName({ path: file }));
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
