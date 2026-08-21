import { pausedExitCode } from '#src/cli/common/constants/pausedExitCode.ts';
import { exitCli } from '#src/cli/common/utils/exitCli.ts';
import type { RunManifest } from '#src/contracts/index.ts';
import { isRunPaused } from '#src/runState/index.ts';

interface Params {
	/** Whether the run finished the work it set out to do. */
	ok: boolean;
	manifest: RunManifest;
}

/**
 * End a run-shaped command with the code that says how the run ended.
 *
 * Every command that drives a run — implement, resume, refactor,
 * test-coverage-to-threshold — exits through here, so all four answer a caller
 * the same way. Written per command, `refactor` and `implement` would disagree
 * about what a rate-limit pause means, and a script driving both would have to
 * know which it was talking to.
 */
export const exitForRunResult = ({ ok, manifest }: Params): Promise<never> => {
	if (ok) {
		return exitCli({ code: 0 });
	}

	return exitCli({ code: isRunPaused({ status: manifest.status }) ? pausedExitCode : 1 });
};
