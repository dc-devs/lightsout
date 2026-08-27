import {
	BatchReport,
	CoverageBatchReport,
	PipelineKind,
	type RefactorBatch,
	type RunBurnDown,
	type RunBurnDownBatch,
	RunBurnDownBatchOutcome,
	type RunManifest,
	type StepRecord,
} from '#src/contracts/index.ts';
import type { FrozenWorklist } from '#src/views/common/types/FrozenWorklist.ts';

/** One work-list batch as the panel shows it, beside the site count it left standing. */
interface JoinedBatch {
	row: RunBurnDownBatch;
	remaining: number;
}

/**
 * The rules whose findings are the sprawl itself — a file, a function or a
 * folder past its cap. `test-size-file` is deliberately outside the set: it
 * never forms a batch, so it could never be counted here.
 */
const overCapRules = new Set(['size-file', 'size-function', 'crowded-folder']);

/** A total across the joined batches — `blocking` for the before side, `remaining` for the after. */
const sumOver = ({ entries, read }: { entries: JoinedBatch[]; read: (entry: JoinedBatch) => number }) =>
	entries.reduce((total, entry) => total + read(entry), 0);

/**
 * One frozen batch joined to what the run recorded against it.
 *
 * A batch the run never reached — and a batch whose recorded report will not
 * parse — reads as `not-run` and counts its frozen blocking findings as still
 * standing, so a run that stopped after the first of eight reads as barely
 * started rather than nearly done.
 */
const toBurnDownBatch = ({ batch, step }: { batch: RefactorBatch; step?: StepRecord }) => {
	const report = step === undefined ? undefined : BatchReport.safeParse(step.report).data;
	const joined: JoinedBatch = {
		row: {
			id: batch.id,
			rule: batch.rule,
			folder: batch.folder,
			blocking: batch.blocking.length,
			outcome: report?.outcome ?? RunBurnDownBatchOutcome.NotRun,
			rationale: report?.rationale ?? [],
			advisoryOutcomes: report?.advisoryOutcomes ?? [],
		},
		remaining: report === undefined ? batch.blocking.length : report.remainingSiteKeys.length,
	};

	return joined;
};

/** The sites a refactor run's work-list froze, against the sites its batches left behind. */
const buildRefactorBurnDown = ({ manifest, batches }: { manifest: RunManifest; batches: RefactorBatch[] }) => {
	const steps: Map<string, StepRecord> = new Map(manifest.steps.map((step) => [step.id, step]));
	const joined = batches.map((batch) => toBurnDownBatch({ batch, step: steps.get(batch.id) }));
	const overCap = joined.filter((entry) => overCapRules.has(entry.row.rule));
	const burnDown: RunBurnDown = {
		before: sumOver({ entries: joined, read: (entry) => entry.row.blocking }),
		after: sumOver({ entries: joined, read: (entry) => entry.remaining }),
		// An already-fixed batch is recorded as resolved with no remaining keys,
		// byte-identical to an agent-resolved one, so the two are not told apart.
		batchesResolved: joined.filter((entry) => entry.row.outcome === RunBurnDownBatchOutcome.Resolved).length,
		batchesDeclined: joined.filter((entry) => entry.row.outcome === RunBurnDownBatchOutcome.Declined).length,
		batches: joined.map((entry) => entry.row),
		overCap:
			overCap.length === 0
				? undefined
				: {
						before: sumOver({ entries: overCap, read: (entry) => entry.row.blocking }),
						after: sumOver({ entries: overCap, read: (entry) => entry.remaining }),
					},
	};

	return burnDown;
};

/**
 * Every file a coverage run measured, earliest reading against latest.
 *
 * No before/after count: the threshold the run was chasing lives in the repo's
 * coverage command rather than in the manifest, so no honest count of "files
 * below threshold" exists here.
 */
const buildCoverageBurnDown = ({ manifest }: { manifest: RunManifest }) => {
	const merged = new Map<string, { path: string; beforePct: number; afterPct: number }>();
	let measured = false;

	for (const step of manifest.steps) {
		const report = CoverageBatchReport.safeParse(step.report).data;

		if (report !== undefined) {
			measured = true;

			for (const file of report.files) {
				merged.set(file.path, { path: file.path, beforePct: merged.get(file.path)?.beforePct ?? file.beforePct, afterPct: file.afterPct });
			}
		}
	}

	const burnDown: RunBurnDown | undefined = measured
		? { batches: [], files: [...merged.values()].sort((first, second) => first.afterPct - second.afterPct || first.path.localeCompare(second.path)) }
		: undefined;

	return burnDown;
};

interface Params {
	manifest: RunManifest;
	/** The run's frozen work-list, already read by the run detail's own helper. */
	worklist: FrozenWorklist | undefined;
}

/**
 * The before and after a refactor or coverage run achieved; undefined for every
 * other pipeline.
 *
 * Computed here rather than in a page, so the number a panel draws and the
 * number a frozen demo run carries come out of the same reader. A refactor run
 * whose work-list is missing or unparseable, and a coverage run none of whose
 * steps recorded a measurement, both answer undefined — no panel, the way
 * `listRuns` skips unreadable state in silence.
 */
export const buildRunBurnDown = ({ manifest, worklist }: Params): RunBurnDown | undefined => {
	let burnDown: RunBurnDown | undefined;

	if (manifest.pipeline === PipelineKind.Coverage) {
		burnDown = buildCoverageBurnDown({ manifest });
	}

	if (manifest.pipeline === PipelineKind.Refactor && worklist?.kind === PipelineKind.Refactor && worklist.worklist !== undefined) {
		burnDown = buildRefactorBurnDown({ manifest, batches: worklist.worklist.batches });
	}

	return burnDown;
};
