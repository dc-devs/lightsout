import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/**
 * True when the calling module was run as a command rather than imported.
 *
 * Compared through realpath on both sides: a path can reach the same file
 * through a symlink — every macOS temp directory does — and a plain string
 * comparison would then decide it was imported, run nothing, and exit 0. For a
 * gate, silently passing is the worst answer available.
 *
 * The caller passes its own `import.meta.url`, which is the one thing this
 * cannot work out for itself: read here, it would always name this file.
 *
 * @param moduleUrl - the calling module's `import.meta.url`
 */
export const invokedDirectly = ({ moduleUrl }) => {
	if (process.argv[1] === undefined) {
		return false;
	}

	try {
		return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(moduleUrl));
	} catch {
		return false;
	}
};
