import type { RawStandardsFinding, StandardsCheckModule } from '@/contracts';
import { buildRawFinding } from '../../../../../common/utils/buildRawFinding.ts';
import { isTestFile } from '../../../../../common/utils/isTestFile.ts';
import { mapFolderModules } from '../../../../../common/utils/mapFolderModules.ts';
import { readBarrelExports } from '../../../../../common/utils/readBarrelExports.ts';
import { readBarrelTargets } from '../../../../../common/utils/readBarrelTargets.ts';
import { readFileTexts } from '../../../../../common/utils/readFileTexts.ts';

/**
 * The published names nothing outside the module mentions — `prefix` is the
 * module folder, and the barrel itself never counts as a consumer of what it
 * publishes.
 *
 * Whole-word counting, conservative by construction: a name in a comment or a
 * string still counts as consumption, so calling a live entry dead is rare.
 * Names under four characters are skipped — they collide with ordinary words
 * too often to measure. A test file counts as a client of the public surface
 * wherever it sits, since a co-located test still exercises the module through
 * its barrel.
 */
const getUnconsumedNames = ({
	names,
	prefix,
	barrelPath,
	contents,
}: {
	names: string[];
	prefix: string;
	barrelPath: string;
	contents: Map<string, string>;
}) =>
	names
		.filter((name) => name.length >= 4)
		.filter((name) => {
			const pattern = new RegExp(`\\b${name}\\b`);

			return ![...contents].some(
				([file, text]) => (!file.startsWith(prefix) || (isTestFile({ path: file }) && file !== barrelPath)) && pattern.test(text),
			);
		});

export const check: StandardsCheckModule = {
	inputKind: 'file-text',
	// Judged only for `module`-status folders: a barrel that hides nothing marks
	// no boundary, so nothing it lists is a public-surface claim to answer for.
	run: ({ input }): RawStandardsFinding[] => {
		const { files, contents } = readFileTexts({ input });
		const fileSet = new Set(files);
		const getTargets = ({ barrelPath }: { barrelPath: string }) =>
			readBarrelTargets({ barrelPath, text: contents.get(barrelPath) ?? '', files: fileSet });

		return [...mapFolderModules({ files, getTargets })]
			.map(([folder, { barrelPath }]) => {
				const names = readBarrelExports({ barrelPath, text: contents.get(barrelPath) ?? '', files: fileSet }).flatMap((entry) => entry.names);
				const orphans = getUnconsumedNames({ names, prefix: `${folder}/`, barrelPath, contents });

				return orphans.length === 0
					? undefined
					: buildRawFinding({
							rule: 'barrel-dead-entry',
							files: [{ path: barrelPath }],
							detail: `${orphans.map((name) => `'${name}'`).join(', ')} ${orphans.length > 1 ? 'are' : 'is'} exported from ${barrelPath} but no file outside module '${folder}' consumes ${orphans.length > 1 ? 'them' : 'it'}`,
							guidance: 'Deliberate public API, or dead? Only the author knows.',
						});
			})
			.filter((finding): finding is RawStandardsFinding => finding !== undefined);
	},
};
