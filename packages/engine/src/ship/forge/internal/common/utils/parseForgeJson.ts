interface Params {
	/** Whatever the forge wrote to stdout — JSON when the call worked, anything at all when it did not. */
	stdout: string;
}

/**
 * A forge command's stdout as JSON, or undefined when it is not JSON at all.
 *
 * Every reader in this folder asks the same question of the same kind of
 * output, and every one of them answers absence the same way, so the narrowing
 * lives once: a `gh` that printed a login prompt, a rate-limit page or nothing
 * must become "no answer" rather than an exception thrown out of a ship step.
 */
export const parseForgeJson = ({ stdout }: Params): unknown => {
	try {
		return JSON.parse(stdout);
	} catch {
		return undefined;
	}
};
