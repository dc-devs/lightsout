import { maskSecrets } from '#src/ship/common/utils/maskSecrets.ts';

interface Params {
	/** The block's own sentence, which an empty stderr leaves exactly as it is. */
	sentence: string;
	/** Whatever the failing command said. */
	stderr: string;
}

/**
 * The block's own sentence, with the failing command's words after it.
 *
 * Redacted before it is kept: the result file is persisted and quoted outward
 * by tracker skills, and `git push` stderr can echo a tokenized remote
 * (`https://user:ghp_xxx@github.com/...`). URL userinfo and token-shaped runs
 * are masked, so a credential can never leave the machine through this file.
 *
 * Capped rather than whole: this is a hand-off a tracker skill quotes into a
 * comment, not a log, so a hook that prints a page of guidance is cut off at
 * the point a human has already got the message. An empty stderr leaves the
 * sentence exactly as it was, so no result ever ends in a bare colon.
 */
export const appendCommandOutput = ({ sentence, stderr }: Params): string => {
	const maxStderrCharacters = 500;
	const trimmed = maskSecrets({ text: stderr }).trim();
	const capped = trimmed.length > maxStderrCharacters ? `${trimmed.slice(0, maxStderrCharacters)}…` : trimmed;

	return capped === '' ? sentence : `${sentence}: ${capped}`;
};
