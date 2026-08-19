import type { StandardsCheckModule } from '@lightsout/standards-contracts';
import { buildFileExportCheck } from '../../../../../common/utils/buildFileExportCheck.ts';
import { collapseCasing } from '../../../../../common/utils/collapseCasing.ts';
import { getExportName } from '../../../../../common/utils/getExportName.ts';

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

/**
 * Silent on a file holding two or more exports: there is no single export for
 * a name to match, and the one-export-per-file rule already owns that file.
 *
 * The comparison ignores casing — which convention a directory follows is the
 * document's own ordered question, and answering it would need the directory's
 * history rather than the file in hand. What is left is mechanical: the file
 * and its export are either the same word or they are not.
 */
export const check: StandardsCheckModule = buildFileExportCheck({
	rule: 'filename-mismatch',
	detail: ({ file, exports }) => {
		const [primary] = exports;
		const fileName = getExportName({ path: file });

		return primary === undefined || exports.length > 1 || isNameMatch({ fileName, exportName: primary.name })
			? undefined
			: `file '${fileName}' exports '${primary.name}'`;
	},
	guidance: 'The filename should match the export it holds.',
});
