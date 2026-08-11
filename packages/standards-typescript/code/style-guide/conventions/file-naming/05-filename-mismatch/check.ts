import type { RawStandardsFinding, StandardsCheckModule } from '@lightsout/standards-contracts';
import { buildRawFinding } from '../../../../../common/utils/buildRawFinding.ts';
import { collapseCasing } from '../../../../../common/utils/collapseCasing.ts';
import { getBaseName } from '../../../../../common/utils/getBaseName.ts';
import { getExportName } from '../../../../../common/utils/getExportName.ts';
import { isTestFile } from '../../../../../common/utils/isTestFile.ts';
import { readFileExports } from '../../../../../common/utils/readFileExports.ts';
import { readFileTexts } from '../../../../../common/utils/readFileTexts.ts';

/**
 * `events.service` → `['events', 'events.service']`. A framework dot-suffix
 * (`.service`, `.model`, `.dto`, `.entity`) is the framework naming the file,
 * which this document says overrides casing entirely — so a name matching
 * either the whole thing or the part before the suffix is a match.
 */
const getDotPrefixes = ({ name }: { name: string }) => name.split('.').map((_, index, segments) => segments.slice(0, index + 1).join('.'));

/** Whether the file's name matches the export it holds, at any of its dot prefixes and in either casing convention. */
const isNameMatch = ({ fileName, exportName }: { fileName: string; exportName: string }) =>
	getDotPrefixes({ name: fileName }).some((candidate) => collapseCasing({ name: candidate }) === collapseCasing({ name: exportName }));

export const check: StandardsCheckModule = {
	inputKind: 'file-text',
	/**
	 * Silent on a file holding two or more exports: there is no single export for
	 * a name to match, and the one-export-per-file rule already owns that file.
	 * Barrels are exempt because a barrel declares nothing of its own, and tests
	 * because the test standards name them after the subject they cover.
	 *
	 * The comparison ignores casing — which convention a directory follows is the
	 * document's own ordered question, and answering it would need the directory's
	 * history rather than the file in hand. What is left is mechanical: the file
	 * and its export are either the same word or they are not.
	 */
	run: ({ input }): RawStandardsFinding[] => {
		const { files, contents, standardsPackages } = readFileTexts({ input });

		return files
			.filter((file) => !isTestFile({ path: file, standardsPackages }) && !getBaseName({ path: file }).startsWith('index.'))
			.map((file) => {
				const exports = readFileExports({ text: contents.get(file) ?? '' });
				const [primary] = exports;
				const fileName = getExportName({ path: file });

				return primary === undefined || exports.length > 1 || isNameMatch({ fileName, exportName: primary.name })
					? undefined
					: buildRawFinding({
							rule: 'filename-mismatch',
							files: [{ path: file }],
							detail: `file '${fileName}' exports '${primary.name}'`,
							guidance: 'The filename should match the export it holds.',
						});
			})
			.filter((finding): finding is RawStandardsFinding => finding !== undefined);
	},
};
