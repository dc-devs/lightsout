import { access } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { AgentInvocation, GateEvidence, PhaseReport, PipelineKind, type RunStepView, type RunView, type StepRecord } from '#src/contracts/index.ts';
import { getRunDir, listRunIds, readFriction, readJsonlRecords, readRunLock, readRunManifest, summarizeRun } from '#src/runState/index.ts';
import { getRunTitle } from '#src/views/common/utils/getRunTitle.ts';
import { loadRunListing } from '#src/views/common/utils/loadRunListing.ts';

/** The per-step spend summarizeRun attributed, keyed by step id. */
type StepUsage = Map<string, { invocations: number; outputTokens: number; costUsd: number }>;

/**
 * A coordinator's step ids ARE the phase file names, extension included
 * (`initializeSequence` records what `readOverviewPhases` returned), so they
 * are joined to the overview's own directory as they stand — the same
 * resolution `runPhasesPipeline` uses to run the phase. The file is named only
 * when it is still there: a phase deleted after its run must not be offered as
 * something to open.
 */
const resolvePhaseFile = async ({ cwd, overviewDir, step }: { cwd: string; overviewDir: string; step: StepRecord }) => {
	const planPath = join(overviewDir, step.id);
	const exists = await access(join(cwd, planPath)).then(
		() => true,
		() => false,
	);

	return exists ? planPath : undefined;
};

/** The manifest's record joined to what the ledger says the step cost, plus the phase links a coordinator's steps carry. */
const buildStepView = async ({
	cwd,
	step,
	usage,
	overviewDir,
}: {
	cwd: string;
	step: StepRecord;
	usage: StepUsage;
	overviewDir?: string;
}): Promise<RunStepView> => {
	const child = PhaseReport.safeParse(step.report);

	return {
		id: step.id,
		status: step.status,
		attempts: step.attempts,
		durationMs: step.durationMs,
		changedFiles: step.changedFiles ?? [],
		error: step.error,
		...(usage.get(step.id) ?? { invocations: 0, outputTokens: 0, costUsd: 0 }),
		report: step.report,
		planPath: overviewDir === undefined ? undefined : await resolvePhaseFile({ cwd, overviewDir, step }),
		childRunId: overviewDir !== undefined && child.success ? child.data.runId : undefined,
	};
};

/**
 * The coordinator that spawned this run, found by asking every other run's
 * manifest whether one of its steps reported this run id. Only manifests are
 * read — a back-link must not cost a pass over every run's JSONL evidence.
 */
const findParent = async ({ cwd, runId }: { cwd: string; runId: string }): Promise<RunView['parent']> => {
	for (const candidateId of await listRunIds({ cwd })) {
		if (candidateId === runId) {
			continue;
		}

		const manifest = await readRunManifest({ cwd, runId: candidateId }).catch(() => undefined);

		if (manifest?.pipeline !== PipelineKind.Phases) {
			continue;
		}

		const step = manifest.steps.find((candidate) => PhaseReport.safeParse(candidate.report).data?.runId === runId);

		if (step !== undefined) {
			return { runId: manifest.runId, step: step.id, title: getRunTitle({ plan: manifest.plan }) };
		}
	}

	return undefined;
};

interface Params {
	cwd: string;
	runId: string;
}

/**
 * One run's whole evidence, assembled: timing, steps, gates, agent spend,
 * friction and files.
 *
 * Every number here is computed by the readers that already own it —
 * `summarizeRun` for timing and per-step cost, the JSONL reader for the two
 * logs, `loadRunListing` for the row a list would show. Nothing is re-derived,
 * so a detail page and a sidebar row cannot disagree.
 *
 * @param cwd - the repo whose run state is read
 * @param runId - full id, or the shortened form a report printed
 * @throws {RunNotFoundError} When no run on disk answers to the id.
 */
export const getRunView = async ({ cwd, runId }: Params): Promise<RunView> => {
	const manifest = await readRunManifest({ cwd, runId });
	const runDir = getRunDir({ cwd, runId: manifest.runId });
	const lock = await readRunLock({ cwd });
	const summary = await summarizeRun({ cwd, manifest });
	const usage: StepUsage = new Map(
		summary.steps.map((step) => [step.id, { invocations: step.invocations, outputTokens: step.outputTokens, costUsd: step.costUsd }]),
	);
	// A coordinator's manifest carries no `overview` field: initializeSequence
	// records the overview as the coordinator's own plan. Its phase files sit
	// beside it, so the same path answers both questions.
	const coordinatorOverview = manifest.pipeline === PipelineKind.Phases ? (manifest.overview ?? manifest.plan) : undefined;
	const overview = coordinatorOverview ?? manifest.overview;
	const overviewDir = coordinatorOverview === undefined ? undefined : dirname(coordinatorOverview);
	const friction = await readFriction({ cwd });

	return {
		listing: await loadRunListing({ cwd, manifest, lock }),
		harness: manifest.harness,
		overview,
		currentStep: manifest.currentStep,
		wallMs: summary.wallMs,
		activeMs: summary.activeMs,
		gateMs: summary.gateMs,
		usage: summary.usage,
		cacheReadShare: summary.cacheReadShare,
		steps: await Promise.all(manifest.steps.map((step) => buildStepView({ cwd, step, usage, overviewDir }))),
		gates: await readJsonlRecords({ path: join(runDir, 'commands.jsonl'), schema: GateEvidence }),
		gateTotals: summary.gates,
		agents: await readJsonlRecords({ path: join(runDir, 'agents.jsonl'), schema: AgentInvocation }),
		rejectedReports: summary.rejectedReports,
		friction: friction.filter((entry) => entry.runId === manifest.runId),
		changedFiles: manifest.changedFiles,
		unreachableChangedFiles: manifest.unreachableChangedFiles,
		parent: await findParent({ cwd, runId: manifest.runId }),
	};
};
