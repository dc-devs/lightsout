import { isTestSideFile } from '#src/common/sourceFiles/isTestSideFile.ts';
import { applyTestDispositions } from '#src/pipeline/approvedTests/applyTestDispositions.ts';
import { approveTestFiles } from '#src/pipeline/approvedTests/approveTestFiles.ts';
import { collectTestChanges } from '#src/pipeline/approvedTests/collectTestChanges.ts';
import { consultTestChangeReviewer } from '#src/pipeline/approvedTests/consultTestChangeReviewer.ts';
import type { PipelineRun } from '#src/pipeline/PipelineRun.ts';
import { appendTestReview } from '#src/runState/index.ts';

interface Params {
	run: PipelineRun;
	/** The verification checkpoint in flight — it labels the agent stream, the usage row and the journal line. */
	checkpoint: string;
	planContent: string;
	overviewContent?: string;
}

/**
 * One checkpoint's test-change review: bundle every test-side file that differs
 * from its approved version, put the whole bundle in front of the read-only
 * reviewer, and hold what comes back to the engine's own rules.
 *
 * A clean review moves the baseline forward — approved copies, the rewritten
 * acceptance mapping, one journal line — and the gates run next. A rejection
 * returns the error the checkpoint goes red on before any gate runs, and nothing
 * is written to the manifest: the next attempt re-reviews the whole bundle
 * against the same baseline, so the repairing role is judged against the
 * baseline it was shown.
 *
 * The engine never writes to the working tree here. Restoring a whole shared
 * file is what this mechanism replaces.
 *
 * @returns an empty object when the bundle was empty or every change was
 * approved; `error` when the checkpoint must go red under the review family;
 * `rateLimited` when the reviewer was rate limited and the run must park.
 */
export const reviewTestChanges = async ({ run, checkpoint, planContent, overviewContent }: Params): Promise<{ error?: string; rateLimited?: boolean }> => {
	const changes = await collectTestChanges({ run });

	if (changes.length === 0) {
		return {};
	}

	const manifest = run.current();
	const step = `${checkpoint}-test-review`;

	run.progress(`${checkpoint}: ${changes.length} test-side file(s) changed — reviewing them against the plan before the gates run`);

	const outcome = await consultTestChangeReviewer({
		driver: run.driver,
		cwd: run.cwd,
		config: run.config,
		planContent,
		overviewContent,
		checkpoint,
		acceptanceTests: manifest.acceptanceTests,
		changedFiles: manifest.changedFiles.filter((file) => !isTestSideFile({ path: file })),
		changes,
		onEvent: run.agentEventSink({ step }),
		onRejectedOutput: run.persistRejected({ step }),
	});

	await run.recordUsage({ step, usage: outcome.usage });

	if (!outcome.ok) {
		// A judge that did not answer is the same shape of red as a judge that
		// said no, and the checkpoint's own repair budget bounds both.
		return outcome.rateLimited ? { rateLimited: true } : { error: `${checkpoint}: the test-change reviewer did not return a verdict — ${outcome.failure}` };
	}

	const applied = await applyTestDispositions({ run, changes, review: outcome.report, acceptanceTests: manifest.acceptanceTests });

	await appendTestReview({
		cwd: run.cwd,
		runId: manifest.runId,
		record: { checkpoint, at: new Date().toISOString(), verdicts: outcome.report.verdicts, rejections: applied.rejections },
	});

	if (applied.rejections.length > 0) {
		return {
			error: [
				"the test-change review refused this checkpoint's changes to the tests; no gate ran.",
				...applied.rejections.map((rejection) => `- ${rejection}`),
			].join('\n'),
		};
	}

	const approvedTests = await approveTestFiles({ run, paths: applied.approvedPaths });

	await run.update({ patch: { approvedTests, acceptanceTests: applied.acceptanceTests } });
	run.progress(`${checkpoint}: the test-change review approved ${applied.approvedPaths.length} test-side file(s) — they are the baseline from here`);

	return {};
};
