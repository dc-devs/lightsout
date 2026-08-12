import type { RawStandardsFinding, StandardsCheckModule } from '@lightsout/standards-contracts';
import { buildRawFinding } from '../../../../../common/utils/buildRawFinding.ts';
import { getBaseName } from '../../../../../common/utils/getBaseName.ts';
import { getDirectory } from '../../../../../common/utils/getDirectory.ts';
import { readBarrelExports } from '../../../../../common/utils/readBarrelExports.ts';
import { readFileTexts } from '../../../../../common/utils/readFileTexts.ts';

/**
 * An internal barrel — the only kind this rule judges. A package or repo `src`
 * root barrel is that package's API, whose consumers are other packages and
 * invisible here; a barrel under `common/` is `path-common-barrel`'s to report,
 * since the objection there is that it exists at all.
 */
const isInternalBarrel = ({ path }: { path: string }) => {
	const directory = getDirectory({ path });

	return /^index\.tsx?$/.test(getBaseName({ path })) && getBaseName({ path: directory }) !== 'src' && !directory.split('/').includes('common');
};

export const check: StandardsCheckModule = {
	inputKind: 'file-text',
	// `export *` publishes whatever the target happens to export today, which is
	// the opposite of a contract that lists exactly what consumers may use.
	run: ({ input }): RawStandardsFinding[] => {
		const { files, contents } = readFileTexts({ input });
		const fileSet = new Set(files);

		return files
			.filter((path) => isInternalBarrel({ path }))
			.map((barrelPath) => {
				const stars = readBarrelExports({ barrelPath, contents, files: fileSet }).filter(({ star }) => star);

				return stars.length === 0
					? undefined
					: buildRawFinding({
							rule: 'barrel-star',
							files: [{ path: barrelPath }],
							detail: `${stars.map(({ specifier }) => `'${specifier}'`).join(', ')} re-exported with \`export *\``,
							guidance: 'A barrel is a module’s public API — list named re-exports instead.',
						});
			})
			.filter((finding): finding is RawStandardsFinding => finding !== undefined);
	},
};
