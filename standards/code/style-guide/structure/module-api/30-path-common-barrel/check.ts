import type { RawStandardsFinding, StandardsCheckModule } from '@/contracts';
import { buildRawFinding } from '../../../../../common/utils/buildRawFinding.ts';
import { getBaseName } from '../../../../../common/utils/getBaseName.ts';
import { getDirectory } from '../../../../../common/utils/getDirectory.ts';
import { readPathLists } from '../../../../../common/utils/readPathLists.ts';

/** A barrel in any source dialect — this rule runs at full strength on JS-only repos. */
const barrelName = /^index\.(m|c)?[jt]sx?$/;

export const check: StandardsCheckModule = {
	inputKind: 'file-list',
	// Decided from the path alone: a barrel asserts a boundary, and every folder
	// under `common/` is boundary-less by definition, so the file's location is
	// the whole objection.
	run: ({ input }): RawStandardsFinding[] =>
		readPathLists({ input })
			.files.filter((file) => barrelName.test(getBaseName({ path: file })) && getDirectory({ path: file }).split('/').includes('common'))
			.map((file) =>
				buildRawFinding({
					rule: 'path-common-barrel',
					files: [{ path: file }],
					detail: `a barrel under ${getDirectory({ path: file })}`,
					guidance: 'A barrel marks a boundary and `common/` is definitionally boundary-less — delete it and import the files directly.',
				}),
			),
};
