import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Ranks this repo's own runs for the three demo slots the site's proof section
 * renders.
 *
 * Its own module beside `freezeDemoRuns.mjs`, the way the sprawl readers sit
 * beside `buildSprawlDataset.mjs`: which run fills a slot is the durable
 * statement of the choice — run ids are local to one machine — while writing
 * the four JSON files is a separate job with nothing to say about it.
 */

/** The batch reports a refactor run recorded — the shape is what says a step was a batch, since the manifest stores reports opaquely. */
const readBatchReports = ({ manifest }) => (manifest.steps ?? []).map((step) => step.report).filter((report) => Array.isArray(report?.remainingSiteKeys));

/**
 * How many blocking sites the run actually cleared: what its work-list froze at
 * the start, less what its batches left standing.
 *
 * The frame exists to show the strongest before/after, so this is what the
 * refactor slot is chosen on. A refactor run's `plan` field IS its frozen
 * work-list, recorded repo-relative, so the manifest names the file rather than
 * the engine being asked where the run's folder sits.
 */
const measureBurnDown = ({ repoRoot, manifest }) => {
	const worklistPath = join(repoRoot, manifest.plan);

	if (!existsSync(worklistPath)) {
		return undefined;
	}

	let worklist;

	try {
		worklist = JSON.parse(readFileSync(worklistPath, 'utf8'));
	} catch {
		return undefined;
	}

	const batches = worklist.batches ?? [];
	const reports = readBatchReports({ manifest });

	// Two batches and two reports, so the frame shows a burn-down rather than a
	// single job. Nothing is asked of the remaining counts themselves: a refactor
	// run only passes once every batch resolved, so on every passed run they are
	// all zero — the before/after this measures is the work-list against that.
	if (batches.length < 2 || reports.length < 2) {
		return undefined;
	}

	const blocking = batches.reduce((total, batch) => total + (batch.blocking?.length ?? 0), 0);
	const remaining = reports.reduce((total, report) => total + report.remainingSiteKeys.length, 0);

	return blocking - remaining;
};

/** Newest first, so a tie is broken by the run a reader would recognize. */
const byNewest = (first, second) => String(second.manifest.updatedAt).localeCompare(String(first.manifest.updatedAt));

/** Every step passed, not just the run — a run that passed with a step retried into submission is not the clean one. */
const isCleanImplement = ({ manifest }) =>
	manifest.pipeline === 'implement' && manifest.status === 'passed' && (manifest.steps ?? []).every((step) => step.status === 'passed');

/** Passed implement runs with every step passed, the one carrying the most steps first. */
const rankImplement = ({ manifests }) =>
	manifests
		.filter(isCleanImplement)
		.sort((first, second) => (second.manifest.steps?.length ?? 0) - (first.manifest.steps?.length ?? 0) || byNewest(first, second));

/** Passed refactor runs whose work-list and reports show a real before and after, the largest measured drop first. */
const rankRefactor = ({ repoRoot, manifests }) =>
	manifests
		.filter(({ manifest }) => manifest.pipeline === 'refactor' && manifest.status === 'passed')
		.map((candidate) => ({ ...candidate, drop: measureBurnDown({ repoRoot, manifest: candidate.manifest }) }))
		.filter((candidate) => candidate.drop !== undefined)
		.sort((first, second) => second.drop - first.drop || byNewest(first, second));

/**
 * Runs that stopped, most recent first.
 *
 * Only the two pipelines the other slots use: a coordinator or a coverage run
 * reads differently in the frame, and the three panels are meant to differ by
 * how the run ended rather than by what shape it is.
 */
const rankStopped = ({ manifests }) =>
	manifests
		.filter(
			({ manifest }) =>
				(manifest.pipeline === 'implement' || manifest.pipeline === 'refactor') && (manifest.status === 'failed' || manifest.status === 'escalated'),
		)
		.sort(byNewest);

/**
 * The candidates for each demo slot, best first.
 *
 * Every slot is a ranked LIST rather than one pick, so the writer can fall
 * through to the next candidate when a manifest is too old for this engine to
 * assemble a view from.
 *
 * @param repoRoot - the checkout the runs and their work-lists are read from
 * @param manifests - every readable run manifest, each wrapped as `{ manifest }`
 */
export const rankDemoRuns = ({ repoRoot, manifests }) => ({
	implement: rankImplement({ manifests }),
	refactor: rankRefactor({ repoRoot, manifests }),
	stopped: rankStopped({ manifests }),
});
