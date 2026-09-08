interface Params {
	text: string;
}

/**
 * One piece of text reduced to the form two spellings of the same sentence share
 * — single spaces, trimmed, lower case.
 *
 * Both places the memory compares text are comparing an agent's re-typing of a
 * plan line against the line itself: a citation the re-verification judge pasted,
 * and a documentation finding a later pass re-reported. Wrapping and casing move
 * freely between those two spellings and mean nothing, so they are removed
 * before the comparison — once, because a rule that says what counts as the same
 * text is worthless if two callers hold different copies of it.
 */
export const collapseText = ({ text }: Params): string => text.replace(/\s+/g, ' ').trim().toLowerCase();
