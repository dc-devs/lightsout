import type { RawStandardsFinding, StandardsCheckModule } from '@lightsout/standards-contracts';
import type { FileExport } from '../types/FileExport.ts';
import { buildRawFinding } from './buildRawFinding.ts';
import { getBaseName } from './getBaseName.ts';
import { isTestFile } from './isTestFile.ts';
import { readFileExports } from './readFileExports.ts';
import { readFileTexts } from './readFileTexts.ts';

interface Params {
	/** The rule id these findings answer for. */
	rule: string;
	/** What one file's exports violate, or undefined when the file is clean. */
	detail: ({ file, exports }: { file: string; exports: FileExport[] }) => string | undefined;
	guidance: string;
	/**
	 * The files this rule does not judge, decided once from the run's whole
	 * scope rather than per file — a framework carve-out needs every manifest in
	 * `contents` to answer, and asking per file would re-read them all each time.
	 */
	getExempt?: ({ files, contents }: { files: string[]; contents: Map<string, string> }) => Set<string>;
}

/**
 * A whole check for a rule that judges a source file by the exports it
 * declares.
 *
 * Every such rule exempts the same two kinds of file for the same reasons — a
 * barrel declares nothing of its own, and the test standards own test files —
 * and every one reaches its verdict the same way: read what the file exports,
 * then either say something about it or say nothing. Only the judgment and the
 * wording differ, so a rule states those and this supplies the rest, leaving
 * the shared half no copy to drift apart from.
 *
 * A rule with an exemption of its own — a framework that names files a document
 * does not get to rename — supplies `getExempt`, which is asked once for the
 * whole run.
 *
 * One finding per file, since the work is "open this file and fix what it
 * says".
 */
export const buildFileExportCheck = ({ rule, detail, guidance, getExempt }: Params): StandardsCheckModule => ({
	inputKind: 'file-text',
	run: ({ input }): RawStandardsFinding[] => {
		const { files, contents, standardsPackages } = readFileTexts({ input });
		const exempt = getExempt?.({ files, contents }) ?? new Set<string>();

		return files
			.filter((file) => !isTestFile({ path: file, standardsPackages }) && !getBaseName({ path: file }).startsWith('index.') && !exempt.has(file))
			.map((file) => {
				const violation = detail({ file, exports: readFileExports({ text: contents.get(file) ?? '' }) });

				return violation === undefined ? undefined : buildRawFinding({ rule, files: [{ path: file }], detail: violation, guidance });
			})
			.filter((finding): finding is RawStandardsFinding => finding !== undefined);
	},
});
