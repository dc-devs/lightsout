import type { RawStandardsFinding, StandardsCheckModule } from '@lightsout/standards-contracts';
import { readFileTexts } from '../../../../../common/checkInput/readFileTexts.ts';
import { readManifestDependencies } from '../../../../../common/checkInput/readManifestDependencies.ts';
import { buildRawFinding } from '../../../../../common/findings/buildRawFinding.ts';
import { getFrameworkCarveOuts } from '../../../../../common/frameworks/getFrameworkCarveOuts.ts';
import { getPathCarveOut } from '../../../../../common/frameworks/getPathCarveOut.ts';
import { isFrameworkLoadedFile } from '../../../../../common/frameworks/isFrameworkLoadedFile.ts';
import { readBarrelExports } from '../../../../../common/modules/readBarrelExports.ts';
import { isBarrelFile } from '../../../../../common/paths/isBarrelFile.ts';

export const check: StandardsCheckModule = {
	inputKind: 'file-text',
	// `export *` publishes whatever the target happens to export today, which is
	// the opposite of a contract that lists exactly what consumers may use. A
	// package's entry is where that contract matters most — other packages build
	// against it — so every index file is judged, the entry included. Whether a
	// folder should have one at all is `folder-index-file`'s question; a route
	// the framework loads is no index file.
	run: ({ input }): RawStandardsFinding[] => {
		const { files, contents } = readFileTexts({ input });
		const fileSet = new Set(files);
		const carveOuts = getFrameworkCarveOuts({ dependencies: readManifestDependencies({ contents }) });

		return files
			.filter((path) => isBarrelFile({ path }) && !isFrameworkLoadedFile({ path, carveOut: getPathCarveOut({ carveOuts, path }) }))
			.map((barrelPath) => {
				const stars = readBarrelExports({ barrelPath, contents, files: fileSet }).filter(({ star }) => star);

				return stars.length === 0
					? undefined
					: buildRawFinding({
							rule: 'barrel-star',
							files: [{ path: barrelPath }],
							detail: `${stars.map(({ specifier }) => `'${specifier}'`).join(', ')} re-exported with \`export *\``,
							guidance: 'An index file is a package’s public API — list named re-exports instead.',
						});
			})
			.filter((finding): finding is RawStandardsFinding => finding !== undefined);
	},
};
