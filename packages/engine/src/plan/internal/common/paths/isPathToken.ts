interface Params {
	token: string;
}

/**
 * Whether a backtick-delimited token names a file: it has a directory separator
 * and an extension.
 *
 * The single spelling of "is this span a path", for the same reason
 * `isPlanSourceFile` is the single spelling of "does this path count": the two
 * path parsers decide what the plan records as a path and the hand-off check
 * decides which spans it compares, so a token one counts and the other does not
 * makes them disagree about the same line with no error anywhere.
 */
export const isPathToken = ({ token }: Params): boolean => token.includes('/') && /\.[A-Za-z0-9]+$/.test(token);
