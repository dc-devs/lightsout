import type { StandardsCheckInput } from '@/contracts';
import type { FileTexts } from '../types/FileTexts.ts';

interface Params {
	/** Whatever the engine built for this run — only a file-text input carries contents. */
	input: StandardsCheckInput;
}

/**
 * The scope and the text a check was handed, for the rules that must read a
 * file rather than judge it by its path — a barrel's re-export lines, a name's
 * references across the repo.
 *
 * An input of any other kind yields an empty scope, for the same reason
 * `readPathLists` does: a rule that declared `file-text` is never handed
 * another kind.
 */
export const readFileTexts = ({ input }: Params): FileTexts =>
	input.kind === 'file-text'
		? { files: input.files, tests: input.tests, referenceFiles: input.referenceFiles, contents: input.contents, standardsPackages: input.standardsPackages }
		: { files: [], tests: [], referenceFiles: [], contents: new Map<string, string>(), standardsPackages: [] };
