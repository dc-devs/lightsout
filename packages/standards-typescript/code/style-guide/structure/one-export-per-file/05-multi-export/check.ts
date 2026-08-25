import type { StandardsCheckModule } from '@lightsout/standards-contracts';
import { buildFileExportCheck } from '../../../../../common/checks/buildFileExportCheck.ts';
import type { FileExport } from '../../../../../common/types/FileExport.ts';

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

/**
 * Exception 5: a type and the single value typed by it — `interface Config`
 * beside `const defaultConfig: Config`. The default has no consumer the type
 * does not already have, so splitting them buys a second file and nothing
 * else. Exactly two exports, one type-level and one `const` whose declaration
 * line annotates it with the co-located type's name.
 */
const isTypedValuePair = ({ exports }: { exports: FileExport[] }) => {
	const typeEntry = exports.find((entry) => entry.keyword === 'interface' || entry.keyword === 'type');
	const constEntry = exports.find((entry) => entry.keyword === 'const');

	return exports.length === 2 && typeEntry !== undefined && constEntry !== undefined && new RegExp(`:\\s*${typeEntry.name}\\b`).test(constEntry.line);
};

/** Exception 3: member interfaces plus exactly one `type` alias, and nothing else in the file. */
const isUnionFamily = ({ exports }: { exports: FileExport[] }) => {
	const interfaces = exports.filter((entry) => entry.keyword === 'interface').length;
	const aliases = exports.filter((entry) => entry.keyword === 'type').length;

	return interfaces > 0 && aliases === 1 && interfaces + 1 === exports.length;
};

export const check: StandardsCheckModule = buildFileExportCheck({
	rule: 'multi-export',
	detail: ({ exports }) =>
		exports.length < 2 || isNamedConstantFamily({ exports }) || isUnionFamily({ exports }) || isTypedValuePair({ exports })
			? undefined
			: `${exports.length} exports (${exports.map(({ name }) => name).join(', ')})`,
	guidance: 'One export per file, outside the closed exception list.',
});
