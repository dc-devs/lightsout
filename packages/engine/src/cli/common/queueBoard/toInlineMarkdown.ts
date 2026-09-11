interface Params {
	text: string;
	/** Longest result, in characters of the collapsed text, counting the ellipsis a clipped text ends in. */
	maxLength?: number;
}

/**
 * Free text — a title, a reason, a question — made safe for one markdown line:
 * whitespace collapsed to single spaces, clipped with an ellipsis when it runs
 * past `maxLength`, then pipes and square brackets escaped so it can neither
 * end a table cell nor open or close a link.
 *
 * Escaping comes last, so a clip never splits an escape in two.
 */
export const toInlineMarkdown = ({ text, maxLength }: Params): string => {
	const characters = Array.from(text.replace(/\s+/g, ' ').trim());
	const clipped = maxLength !== undefined && characters.length > maxLength ? [...characters.slice(0, maxLength - 1), '…'] : characters;

	return clipped.join('').replace(/[|[\]]/g, (character) => `\\${character}`);
};
