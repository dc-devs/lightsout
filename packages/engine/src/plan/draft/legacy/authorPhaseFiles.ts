import { join } from 'node:path';
import { buildPlanWriterInvocation } from '#src/agents/index.ts';
import { createdFileCeiling } from '#src/common/constants/createdFileCeiling.ts';
import { type ConfigDocs, type DecisionsRecord, type Effort, type Permissions, PlanDraftReport, type PlanFacts, PlanVariant } from '#src/contracts/index.ts';
import type { Driver } from '#src/drivers/index.ts';
import { planDraftConcurrency } from '#src/plan/common/constants/planDraftConcurrency.ts';
import type { PhaseDeclaration } from '#src/plan/common/types/PhaseDeclaration.ts';
import { createPlanAgentRunner } from '#src/plan/common/utils/createPlanAgentRunner.ts';
import { drainTasks } from '#src/plan/common/utils/drainTasks.ts';
import { isRateLimited } from '#src/plan/common/utils/isRateLimited.ts';
import type { AuthorPhaseFilesResult } from '#src/plan/draft/common/types/AuthorPhaseFilesResult.ts';
import type { PhaseOutcome } from '#src/plan/draft/common/types/PhaseOutcome.ts';
import { foldPhaseOutcomes } from '#src/plan/draft/common/utils/foldPhaseOutcomes.ts';
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
	/** The repository's declared documentation surfaces, threaded through so a phase file carries the same `## Documentation` claim a single plan would. */
	docs?: ConfigDocs;
	/** `plan.contract` from config, threaded through so a phase file carries the same acceptance-test ledger a single plan would. */
	contract?: boolean;
	model?: string;
	effort?: Effort;
	permissions?: Permissions;
	timeoutMs: number;
	progress: (message: string) => void;
}

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
	const { cwd, driver, name, workspaceDir, facts, decisions, overviewText, executorFileLimit, standards, docs, contract } = params;
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
			docs,
			contract,
		}),
		contract: PlanDraftReport,
	});

	progress(`plan draft ${name}: ${declaration.file} — ${outcome.ok ? outcome.report.status : 'spawn failed'}`);

	return { declaration, outcome };
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
