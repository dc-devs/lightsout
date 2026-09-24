import type { RawStandardsFinding, StandardsCheckModule } from '@lightsout/standards-contracts';
import { readTestFiles } from '../../../common/checkInput/readTestFiles.ts';
import { buildLineSites } from '../../../common/findings/buildLineSites.ts';
import { buildRawFinding } from '../../../common/findings/buildRawFinding.ts';
import { blankStringsAndComments } from '../../../common/parsing/blankStringsAndComments.ts';
import { readCallBlocks } from '../../../common/parsing/readCallBlocks.ts';
import type { CallBlock } from '../../../common/types/CallBlock.ts';

/**
 * A property whose value is the bare `undefined`, read with strings blanked —
 * so a quoted key still matches, as a run of spaces between its quotes.
 */
const undefinedProperty = /^\s*(?:[A-Za-z_$][\w$]*|(['"])[^'"]*\1)\s*:\s*undefined\s*$/;

/** The comma-separated entries of an object's contents that sit outside every nested bracket, as offsets into it. */
const topLevelEntries = ({ mask }: { mask: string }) => {
	const entries: Array<{ from: number; to: number }> = [];
	let depth = 0;
	let from = 0;

	for (let cursor = 0; cursor < mask.length; cursor += 1) {
		const char = mask.charAt(cursor);

		depth += '([{'.includes(char) ? 1 : ')]}'.includes(char) ? -1 : 0;

		if (depth === 0 && char === ',') {
			entries.push({ from, to: cursor });
			from = cursor + 1;
		}
	}

	return [...entries, { from, to: mask.length }];
};

/**
 * The keys an `expect.objectContaining` call pairs with `undefined`, each on
 * the line it is written on.
 *
 * Only the sample's own keys: the matcher demands each of those be present,
 * while a nested object is compared by plain equality, which already treats a
 * key holding `undefined` as absent. The block's body is the object literal's
 * contents, braces excluded, because `readCallBlocks` reads a braced argument
 * the way it reads a block body — an argument that is not an object literal
 * holds no top-level `key: value` entry and yields nothing.
 */
const undefinedKeysOf = ({ block }: { block: CallBlock }) => {
	const mask = blankStringsAndComments({ text: block.body });

	return topLevelEntries({ mask })
		.filter(({ from, to }) => undefinedProperty.test(mask.slice(from, to)))
		.map(({ from, to }) => {
			const entryMask = mask.slice(from, to);
			const start = from + entryMask.search(/\S/);
			const key = block.body
				.slice(start, from + entryMask.indexOf(':'))
				.trim()
				.replace(/^['"]|['"]$/g, '');

			return { key, line: block.startLine + (block.body.slice(0, start).match(/\n/g)?.length ?? 0) };
		});
};

const neverPassingFindings = ({ file, text }: { file: string; text: string }) => {
	const keys = readCallBlocks({ text, callees: ['expect.objectContaining'] }).flatMap((block) => undefinedKeysOf({ block }));

	return keys.length === 0
		? []
		: [
				buildRawFinding({
					rule: 'test-never-passing-assertion',
					files: buildLineSites({ file, spans: keys.map(({ line }) => ({ startLine: line, endLine: line })) }),
					detail: `expect.objectContaining pairs a key with undefined, which requires the key to be present — an object without it, such as one read back from JSON, never matches: ${keys.map(({ key, line }) => `\`${key}\` at line ${line}`).join(', ')}`,
					guidance:
						"To say a key is absent, drop it from the matcher and compare `Object.hasOwn(value, 'key')` against `false`; to say its value is undefined either way, assert `value.key` with `toBe(undefined)`.",
				}),
			];
};

export const check: StandardsCheckModule = {
	inputKind: 'test-file',
	run: ({ input }): RawStandardsFinding[] => readTestFiles({ input }).flatMap(neverPassingFindings),
};
