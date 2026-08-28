interface Params {
	template: string;
	/** Brace-wrapped names the template may use: the ticket pattern's named groups, plus `branch`. */
	tokens: Record<string, string>;
}

/**
 * The pull request body, with every brace-wrapped token the caller supplied
 * substituted and every one it did not left exactly as written.
 *
 * An unknown token stays visible on purpose: a template naming a group the
 * ticket pattern does not capture is a config mistake, and a pull request
 * showing `{number}` says so where a silently blanked line would not.
 *
 * One pass over the template, so a substituted value that happens to contain
 * braces is never re-scanned as a token of its own.
 */
export const renderPullRequestBody = ({ template, tokens }: Params): string => {
	return template.replace(/\{([a-zA-Z0-9_-]+)\}/g, (written, name: string) => tokens[name] ?? written);
};
