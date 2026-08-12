import type { PathAliases } from '../types/PathAliases.ts';
import { getDirectory } from './getDirectory.ts';
import { joinPath } from './joinPath.ts';

/**
 * The same text with line and block comments replaced by spaces, quoted
 * strings left intact.
 *
 * A tsconfig is JSON with comments — every one in this repo has them — so a
 * JSON parser is not an option, and cutting comments by regex would eat the
 * double slash inside any string that happens to hold a URL. Positions are
 * preserved so nothing downstream has to care that this ran.
 */
const stripComments = ({ text }: { text: string }): string => {
	const chars = text.split('');
	let index = 0;

	while (index < text.length) {
		const character = text[index];
		const next = text[index + 1];

		if (character === '"') {
			index += 1;

			while (index < text.length && text[index] !== '"') {
				index += text[index] === '\\' ? 2 : 1;
			}

			index += 1;
		} else if (character === '/' && (next === '/' || next === '*')) {
			const ended = next === '/' ? text.indexOf('\n', index) : text.indexOf('*/', index + 2);
			const stop = ended === -1 ? text.length : ended + (next === '/' ? 0 : 2);

			for (let cursor = index; cursor < stop; cursor += 1) {
				if (chars[cursor] !== '\n') {
					chars[cursor] = ' ';
				}
			}

			index = stop;
		} else {
			index += 1;
		}
	}

	return chars.join('');
};

/** The `{...}` following a key, by brace balance — the block form no flat regex can match. */
const readBlock = ({ text, key }: { text: string; key: string }): string | undefined => {
	const opened = new RegExp(`"${key}"\\s*:\\s*\\{`).exec(text);

	if (opened === null) {
		return undefined;
	}

	const from = opened.index + opened[0].length;
	let depth = 1;

	for (let index = from; index < text.length; index += 1) {
		depth += text[index] === '{' ? 1 : 0;
		depth -= text[index] === '}' ? 1 : 0;

		if (depth === 0) {
			return text.slice(from, index);
		}
	}

	return undefined;
};

const entryLine = /"([^"]+)"\s*:\s*\[([^\]]*)\]/g;
const quoted = /"([^"]*)"/g;

interface Params {
	/** Repo-relative path of the tsconfig this text came from — its folder anchors the targets. */
	tsconfigPath: string;
	/** The tsconfig's contents. */
	text: string;
}

/**
 * The path aliases one tsconfig declares, or `undefined` when this file alone
 * cannot answer.
 *
 * An empty `patterns` map is a real answer, not a missing one: a config that
 * declares no aliases means a bare specifier is a published package, and the
 * rules that resolve one may say so with confidence. `undefined` is reserved
 * for a config that declares no `paths` of its own but does `extends` another,
 * because the aliases could be in the file it inherits from and this reader
 * does not follow that chain. Answering "no aliases" there would turn every
 * aliased import in the package into a confident "external", which is the
 * mistake this whole distinction exists to prevent.
 *
 * Targets are anchored the way TypeScript anchors them: to `baseUrl` when the
 * config sets one, and to the config's own folder when it does not.
 */
export const readPathAliases = ({ tsconfigPath, text }: Params): PathAliases | undefined => {
	const stripped = stripComments({ text });
	const block = readBlock({ text: stripped, key: 'paths' });
	const folder = getDirectory({ path: tsconfigPath });

	if (block === undefined) {
		return /"extends"\s*:/.test(stripped) ? undefined : { base: folder, patterns: new Map() };
	}

	const baseUrl = /"baseUrl"\s*:\s*"([^"]*)"/.exec(stripped)?.[1];
	const patterns = new Map<string, string[]>();

	for (const [, pattern, targets] of block.matchAll(entryLine)) {
		patterns.set(
			pattern,
			[...targets.matchAll(quoted)].map(([, target]) => target),
		);
	}

	return { base: baseUrl === undefined ? folder : joinPath({ from: folder, specifier: baseUrl }), patterns };
};
