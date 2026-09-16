import { join } from 'node:path';
import { buildFocusedPlanWriterInvocation } from '#src/agents/index.ts';
import { createdFileCeiling } from '#src/common/constants/createdFileCeiling.ts';
import {
	type ConfigDocs,
	type DecisionsRecord,
	type Effort,
	type Permissions,
	PlanDraftReport,
	type PlanFacts,
	PlanVariant,
	type SourceEvidenceIndex,
} from '#src/contracts/index.ts';
import type { Driver } from '#src/drivers/index.ts';
import { planDraftConcurrency } from '#src/plan/common/constants/planDraftConcurrency.ts';
import type { PhaseDeclaration } from '#src/plan/common/types/PhaseDeclaration.ts';
import { createPlanAgentRunner } from '#src/plan/common/utils/createPlanAgentRunner.ts';
import { drainTasks } from '#src/plan/common/utils/drainTasks.ts';
import { isRateLimited } from '#src/plan/common/utils/isRateLimited.ts';
import { planWriterEnvironment } from '#src/plan/draft/common/constants/planWriterEnvironment.ts';
import type { AuthorPhaseFilesResult } from '#src/plan/draft/common/types/AuthorPhaseFilesResult.ts';
import type { PhaseOutcome } from '#src/plan/draft/common/types/PhaseOutcome.ts';
import { foldPhaseOutcomes } from '#src/plan/draft/common/utils/foldPhaseOutcomes.ts';
import { selectPhaseEvidence } from '#src/plan/draft/focused/common/utils/selectPhaseEvidence.ts';
import { buildExportCensus, detectExportCollisions, type ExportCensus, renderEvidenceBrief } from '#src/plan/evidence/index.ts';
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
	/** The draft's collected source evidence, narrowed per phase before it is rendered. */
	evidence: SourceEvidenceIndex;
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

/** One focused phase spawn: its own runner, its own transcript, and exactly one output path the engine dictates. */
const spawnPhase = async ({
	params,
	declaration,
	previousDeclaration,
	census,
}: {
	params: Params;
	declaration: PhaseDeclaration;
	previousDeclaration?: PhaseDeclaration;
	/** The repository's existing exports, built once for the whole fan-out. */
	census: ExportCensus;
}): Promise<PhaseOutcome> => {
	const { cwd, driver, name, workspaceDir, facts, decisions, overviewText, evidence, executorFileLimit, standards, docs, contract } = params;
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
		environment: planWriterEnvironment,
	});
	const selected = selectPhaseEvidence({ evidence, facts, declaration });
	const outcome = await invokePlanAgent({
		invocation: buildFocusedPlanWriterInvocation({
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
			evidenceBrief: renderEvidenceBrief({ index: selected, paths: selected.entries.map((entry) => entry.path) }),
			collisions: detectExportCollisions({ census, symbols: declaration.exports }),
		}),
		contract: PlanDraftReport,
	});

	progress(`plan draft ${name}: ${declaration.file} — ${outcome.ok ? outcome.report.status : 'spawn failed'}`);

	return { declaration, outcome };
};

/**
 * Spawn one focused plan-writer per declared phase, concurrently, each authoring
 * exactly one `phase<N>-<slug>.md` against the overview's settled declaration.
 *
 * Each spawn carries its own narrowed evidence brief and the census result for
 * the symbols its declaration names, and each requests the focused environment.
 * What a spawn carries is stated here; how its outcome is read afterwards is
 * not, which is why the result type lives beside the declaration rather than in
 * this file. The transcript step names are unchanged —
 * `scripts/comparePlanDrafts.mjs` reads them by those names.
 *
 * The export census is built once here rather than per spawn: it is one
 * repository-wide read, and every phase's declared symbols are compared against
 * the same copy of it.
 *
 * `planDraftConcurrency` is read unchanged and deliberately not raised: the bound
 * is the harness rate limit rather than a cost the cheaper spawn buys back, and
 * one rate-limited spawn parks the whole draft.
 *
 * A phase spawn gets no self-lint command: its siblings are not on disk yet, so
 * a lint run there would report artefacts of when it looked rather than defects.
 */
export const authorFocusedPhaseFiles = async (params: Params): Promise<AuthorPhaseFilesResult> => {
	const { cwd, name, declarations, progress } = params;

	progress(`plan draft ${name}: authoring ${declarations.length} phase file(s), up to ${planDraftConcurrency} at a time`);

	const census = await buildExportCensus({ cwd });
	const tasks = declarations.map(
		(declaration, index) => () => spawnPhase({ params, declaration, previousDeclaration: index === 0 ? undefined : declarations[index - 1], census }),
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
