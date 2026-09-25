import type { RawStandardsFinding, StandardsCheckModule } from '@lightsout/standards-contracts';
import { readFileTexts } from '../../../../../common/checkInput/readFileTexts.ts';
import { readManifestDependencies } from '../../../../../common/checkInput/readManifestDependencies.ts';
import { readPackageEntries } from '../../../../../common/checkInput/readPackageEntries.ts';
import { buildRawFinding } from '../../../../../common/findings/buildRawFinding.ts';
import { getFrameworkCarveOuts } from '../../../../../common/frameworks/getFrameworkCarveOuts.ts';
import { getPathCarveOut } from '../../../../../common/frameworks/getPathCarveOut.ts';
import { isFrameworkLoadedFile } from '../../../../../common/frameworks/isFrameworkLoadedFile.ts';
import { isPackageEntry } from '../../../../../common/modules/isPackageEntry.ts';
import { getDirectory } from '../../../../../common/paths/getDirectory.ts';
import { isBarrelFile } from '../../../../../common/paths/isBarrelFile.ts';

export const check: StandardsCheckModule = {
	inputKind: 'file-text',
	/**
	 * An index file is a package's entry, and nothing else.
	 *
	 * Every import names the file that declares what it imports, so an index
	 * file inside a package lists names nothing reads through it. A package's
	 * entry is the exception, because other packages do: one sitting at the
	 * package root or its `src/`, or one the manifest names — a subpath export
	 * pointing into a folder included. A route the framework loads is no index
	 * file at all.
	 *
	 * File text rather than a path list, because which files a package
	 * publishes is written in its manifest, and only this input carries it.
	 */
	run: ({ input }): RawStandardsFinding[] => {
		const { files, contents } = readFileTexts({ input });
		const carveOuts = getFrameworkCarveOuts({ dependencies: readManifestDependencies({ contents }) });
		const entries = readPackageEntries({ contents });

		return files
			.filter(
				(path) =>
					isBarrelFile({ path }) && !isPackageEntry({ path, entries }) && !isFrameworkLoadedFile({ path, carveOut: getPathCarveOut({ carveOuts, path }) }),
			)
			.map((path) =>
				buildRawFinding({
					rule: 'folder-index-file',
					files: [{ path }],
					detail: `an index file in ${getDirectory({ path })}, which is no package entry`,
					guidance: 'Every import names the file that declares it, so a folder index lists names nothing reads — delete it.',
				}),
			);
	},
};
