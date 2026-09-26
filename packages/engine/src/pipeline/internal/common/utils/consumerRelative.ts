interface Params {
	/** The consumer root's path inside its git repo ('' when it IS the root). */
	gitPrefix?: string;
	file: string;
}

/**
 * Agents in a consumer nested inside a larger git repo sometimes echo
 * repo-ROOT-relative paths in their reports (observed live: the same file
 * counted twice, doubling its test writers). Strip the git prefix so both
 * changed-file truths speak consumer-relative paths.
 */
export const consumerRelative = ({ gitPrefix, file }: Params): string => (gitPrefix && file.startsWith(gitPrefix) ? file.slice(gitPrefix.length) : file);
