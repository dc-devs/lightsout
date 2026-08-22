import { join } from 'node:path';
import { buildPlanWriterInvocation } from '#src/agents/index.ts';
import { createdFileCeiling } from '#src/common/constants/createdFileCeiling.ts';
import { type DecisionsRecord, type Effort, type Permissions, PlanDraftReport, PlanDraftStatus, type PlanFacts, PlanVariant } from '#src/contracts/index.ts';
import type { Driver } from '#src/drivers/index.ts';
import type { AgentOutcome } from '#src/invoke/index.ts';
import { PlanRunStatus } from '#src/plan/common/constants/PlanRunStatus.ts';
import { planDraftConcurrency } from '#src/plan/common/constants/planDraftConcurrency.ts';
import { verifyDraftedFiles } from '#src/plan/common/paths/verifyDraftedFiles.ts';
import type { PhaseDeclaration } from '#src/plan/common/types/PhaseDeclaration.ts';
import { createPlanAgentRunner } from '#src/plan/common/utils/createPlanAgentRunner.ts';
import { drainTasks } from '#src/plan/common/utils/drainTasks.ts';
import { planWorkspaceDir } from '#src/plan/planWorkspaceDir.ts';

interface Params {
	cwd: string;
	driver: Driver;
	name: string;
	workspaceDir: string;
	facts: PlanFacts;
	decisions: DecisionsRecord;
	/** The settled overview text, given to every phase agent as context. */
	overviewText: string;
	/** One row per phase, ordered — one agent per row. */
	declarations: PhaseDeclaration[];
	/** `executor-file-limit` from config, already defaulted — the number the template's size rules are stated with. */
	executorFileLimit: number;
	standards?: string;
	model?: string;
	effort?: Effort;
	permissions?: Permissions;
	timeoutMs: number;
	progress: (message: string) => void;
}

type AuthorPhaseFilesResult =
	| { status: typeof PlanRunStatus.Complete; planPaths: string[]; reports: PlanDraftReport[] }
	| { status: typeof PlanRunStatus.Failed; error: string }
	| { status: typeof PlanRunStatus.PausedRateLimit; error: string }
	| { status: typeof PlanRunStatus.FactsError; discrepancies: string[] };

/** One phase spawn's result, labelled with the declaration row it was authoring. */
interface PhaseOutcome {
	declaration: PhaseDeclaration;
	outcome: AgentOutcome<PlanDraftReport>;
}

/** Whether a settled phase spawn hit the harness rate-limit wall — the one outcome that stops the fan-out feeding it. */
const isRateLimited = ({ result }: { result: PhaseOutcome | undefined }) => result !== undefined && !result.outcome.ok && result.outcome.rateLimited;

/** One phase spawn: its own runner, its own transcript, and exactly one output path the engine dictates. */
const spawnPhase = async ({
	params,
	declaration,
	previousDeclaration,
}: {
	params: Params;
	declaration: PhaseDeclaration;
	previousDeclaration?: PhaseDeclaration;
}): Promise<PhaseOutcome> => {
	const { cwd, driver, name, workspaceDir, facts, decisions, overviewText, executorFileLimit, standards } = params;
	const { model, effort, permissions, timeoutMs, progress } = params;
	const invokePlanAgent = createPlanAgentRunner({
		cwd,
		driver,
		workspaceDir,
		step: `draft-phase${declaration.number}`,
		model,
		effort,
		permissions,
		timeoutMs,
	});
	const outcome = await invokePlanAgent({
		invocation: buildPlanWriterInvocation({
			facts,
			decisions,
			outputs: [{ path: join(planWorkspaceDir({ cwd, name }), declaration.file), variant: PlanVariant.Phase }],
			overviewText,
			declaration,
			previousDeclaration,
			limits: { executorFileLimit, createdFileCeiling },
			standards,
		}),
		contract: PlanDraftReport,
	});

	progress(`plan draft ${name}: ${declaration.file} — ${outcome.ok ? outcome.report.status : 'spawn failed'}`);

	return { declaration, outcome };
};

/**
 * Fold every phase's outcome in one pass. Failures accumulate with the phase
 * file that produced them rather than short-circuiting, so one bad phase does
 * not hide the other nine, and a rate limit anywhere parks the whole draft —
 * it is resumable, and the phases that did land are overwritten by the re-run.
 */
const foldPhaseOutcomes = async ({
	cwd,
	name,
	declarations,
	results,
}: {
	cwd: string;
	name: string;
	declarations: PhaseDeclaration[];
	results: Array<PhaseOutcome | undefined>;
}): Promise<AuthorPhaseFilesResult> => {
	if (results.some((result) => isRateLimited({ result }))) {
		return { status: PlanRunStatus.PausedRateLimit, error: `rate limited or overloaded — re-run: lightsout plan draft --name ${name}` };
	}

	const discrepancies: string[] = [];
	const failures: string[] = [];
	const reports: PlanDraftReport[] = [];
	const filesWritten: { path: string }[] = [];

	for (const [index, result] of results.entries()) {
		const file = result?.declaration.file ?? declarations[index].file;

		if (result === undefined) {
			failures.push(`${file}: not authored`);
		} else if (!result.outcome.ok) {
			failures.push(`${file}: ${result.outcome.failure}`);
		} else if (result.outcome.report.status === PlanDraftStatus.Error) {
			discrepancies.push(...result.outcome.report.discrepancies.map((discrepancy) => `${file}: ${discrepancy}`));
		} else {
			reports.push(result.outcome.report);
			filesWritten.push(...result.outcome.report.filesWritten);
		}
	}

	if (discrepancies.length > 0) {
		return { status: PlanRunStatus.FactsError, discrepancies };
	}

	if (failures.length > 0) {
		return { status: PlanRunStatus.Failed, error: failures.join('; ') };
	}

	const drafted = await verifyDraftedFiles({ cwd, filesWritten });

	return 'error' in drafted
		? { status: PlanRunStatus.Failed, error: drafted.error }
		: { status: PlanRunStatus.Complete, planPaths: drafted.planPaths, reports };
};

/**
 * Spawn one plan-writer per declared phase, concurrently, each authoring exactly
 * one `phase<N>-<slug>.md` against the overview's settled declaration.
 *
 * Concurrency is what the declaration buys: without it a phase agent would have
 * to read its predecessors' finished text, which is a sequential chain, and the
 * single all-phases spawn it replaces was killed at its timeout mid-draft. The
 * cross-phase lint is what makes it safe — a parallel drafter's provenance and
 * hand-off mismatches are caught deterministically before any agent grades.
 *
 * A phase spawn gets no self-lint command: its siblings are not on disk yet, so
 * a lint run there would report artefacts of when it looked rather than defects.
 * `repairPlanStructure` converges the finished set instead.
 */
export const authorPhaseFiles = async (params: Params): Promise<AuthorPhaseFilesResult> => {
	const { cwd, name, declarations, progress } = params;

	progress(`plan draft ${name}: authoring ${declarations.length} phase file(s), up to ${planDraftConcurrency} at a time`);

	const tasks = declarations.map(
		(declaration, index) => () => spawnPhase({ params, declaration, previousDeclaration: index === 0 ? undefined : declarations[index - 1] }),
	);
	// A wall met by launching another eighteen spawns into it is still a wall:
	// once one phase rate-limits, no further phase is started.
	const results = await drainTasks({
		tasks,
		concurrency: planDraftConcurrency,
		shouldStop: ({ results: settled }) => settled.some((result) => isRateLimited({ result })),
	});

	return foldPhaseOutcomes({ cwd, name, declarations, results });
};
