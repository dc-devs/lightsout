import { notFound } from '@tanstack/react-router';
import { findRepoRoot } from '#src/common/utils/findRepoRoot.ts';
import { isPublicDeployment } from '#src/common/utils/isPublicDeployment.ts';

/**
 * The repo `/app` reads, and the one gate every server-side read of it passes.
 *
 * On the public site this throws the router's not-found signal, so a server
 * function behind `/app` answers exactly as its page does: nothing is there.
 * `getReader` and `getRepoRootServerFn` are the only callers, which is what
 * makes the refusal impossible to forget on a new server function — reaching
 * repo state means coming through here.
 *
 * Locally, a server started outside any lightsout repo has nothing to read, and
 * says so in a message naming the fix rather than rendering empty pages.
 *
 * @throws {NotFoundError} On the public site.
 * @throws {Error} Locally, when no `lightsout.config.json` sits above the working directory and `LIGHTSOUT_REPO` names none.
 */
export const requireLocalRepoRoot = (): string => {
	if (isPublicDeployment()) {
		throw notFound();
	}

	const repoRoot = findRepoRoot();

	if (repoRoot === undefined) {
		throw new Error(
			`No lightsout.config.json was found in ${process.cwd()} or any folder above it. Start the app from inside a lightsout repo, or set LIGHTSOUT_REPO to one.`,
		);
	}

	return repoRoot;
};
