import type { RawStandardsFinding, StandardsCheckModule } from '@lightsout/standards-contracts';
import type { FileExport } from '../../../../../common/types/FileExport.ts';
import { buildRawFinding } from '../../../../../common/utils/buildRawFinding.ts';
import { getBaseName } from '../../../../../common/utils/getBaseName.ts';
import { isTestFile } from '../../../../../common/utils/isTestFile.ts';
import { readFileExports } from '../../../../../common/utils/readFileExports.ts';
import { readFileTexts } from '../../../../../common/utils/readFileTexts.ts';

/**
 * Exception 4: a `const` object and the union derived from it share one name,
 * and any lookup map typed `Record<ThatName, …>` is tautologically coupled to
 * both.
 */
const isNamedConstantFamily = ({ exports }: { exports: FileExport[] }) => {
	const withKeyword = ({ keyword }: { keyword: string }) => exports.filter((entry) => entry.keyword === keyword);
	const unionName = withKeyword({ keyword: 'const' }).find(({ name }) => withKeyword({ keyword: 'type' }).some((entry) => entry.name === name))?.name;

	return (
		unionName !== undefined && exports.every(({ keyword, name, line }) => name === unionName || (keyword === 'const' && line.includes(`Record<${unionName}`)))
	);
};

/** Exception 3: member interfaces plus exactly one `type` alias, and nothing else in the file. */
const isUnionFamily = ({ exports }: { exports: FileExport[] }) => {
	const interfaces = exports.filter((entry) => entry.keyword === 'interface').length;
	const aliases = exports.filter((entry) => entry.keyword === 'type').length;

	return interfaces > 0 && aliases === 1 && interfaces + 1 === exports.length;
};

export const check: StandardsCheckModule = {
	inputKind: 'file-text',
	// Barrels are exempt by their nature — a barrel is a list of re-exports, and
	// listing them is the job. Tests are exempt for the same reason the rest of
	// the code standards leave them to the test standards.
	run: ({ input }): RawStandardsFinding[] => {
		const { files, contents, standardsPackages } = readFileTexts({ input });

		return files
			.filter((file) => !isTestFile({ path: file, standardsPackages }) && !getBaseName({ path: file }).startsWith('index.'))
			.map((file) => {
				const exports = readFileExports({ text: contents.get(file) ?? '' });

				return exports.length < 2 || isNamedConstantFamily({ exports }) || isUnionFamily({ exports })
					? undefined
					: buildRawFinding({
							rule: 'multi-export',
							files: [{ path: file }],
							detail: `${exports.length} exports (${exports.map(({ name }) => name).join(', ')})`,
							guidance: 'One export per file, outside the closed exception list.',
						});
			})
			.filter((finding): finding is RawStandardsFinding => finding !== undefined);
	},
};
