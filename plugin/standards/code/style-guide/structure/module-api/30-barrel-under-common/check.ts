import type { RawStandardsFinding, StandardsCheckModule } from '@lightsout/standards-contracts';
import { readPathLists } from '../../../../../common/checkInput/readPathLists.ts';
import { buildRawFinding } from '../../../../../common/findings/buildRawFinding.ts';
import { getDirectory } from '../../../../../common/paths/getDirectory.ts';
import { isBarrelFile } from '../../../../../common/paths/isBarrelFile.ts';

export const check: StandardsCheckModule = {
	inputKind: 'file-list',
	// Decided from the path alone: a barrel asserts a boundary, and every folder
	// under `common/` is boundary-less by definition, so the file's location is
	// the whole objection.
	run: ({ input }): RawStandardsFinding[] =>
		readPathLists({ input })
			.files.filter((file) => isBarrelFile({ path: file }) && getDirectory({ path: file }).split('/').includes('common'))
			.map((file) =>
				buildRawFinding({
					rule: 'barrel-under-common',
					files: [{ path: file }],
					detail: `a barrel under ${getDirectory({ path: file })}`,
					guidance: 'A barrel marks a boundary, and `common/` has none to mark — delete it and import the files directly.',
				}),
			),
};
