import type { StandardsFinding } from '#src/contracts/index.ts';
import type { PipelineRun } from '#src/pipeline/PipelineRun.ts';
import { runStandardsReview } from '#src/standardsCheck/index.ts';
import type { LoadedStandardsPack } from '#src/standardsPacks/index.ts';

interface Params {
	run: PipelineRun;
	packs: LoadedStandardsPack[];
	channels: string[];
	/** Repo-relative files to review; an empty list spends no agent. */
	files: string[];
}

/**
 * The agent's read of the judgment-only rules over a named file list.
 *
 * Called twice by the cleanup loop with different scopes — the run's changed
 * source before the first round, and the files cleanup actually changed after
 * the last — which is why it is a file of its own rather than a helper inside
 * the step.
 *
 * It never throws: a review that could not run narrates why and contributes
 * nothing, because the deterministic checks are the real evidence and must not
 * wait on an opinion.
 */
export const reviewAdvisories = async ({ run, packs, channels, files }: Params): Promise<StandardsFinding[]> => {
	const review = await runStandardsReview({
		cwd: run.cwd,
		driver: run.driver,
		packs,
		channels,
		files,
		timeoutMs: run.agentTimeoutMs,
		onProgress: (message) => run.progress(message),
	});

	for (const note of review.notes) {
		run.progress(note);
	}

	return review.findings;
};
