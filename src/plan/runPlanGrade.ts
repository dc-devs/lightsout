import { basename, join } from 'node:path';
import { GapCheckReport, PlanGrade, type Effort, type GradeReport, type Permissions, type PlanGap } from '@/contracts';
import { buildPlanGapCheckInvocation } from '@/agents';
import type { Driver } from '@/drivers';
import { createPlanAgentRunner } from '@/plan/common/utils/createPlanAgentRunner';
import { detectPriorArtCandidates } from '@/plan/detectPriorArtCandidates';
import { getPlanDetectionPass } from '@/plan/common/utils/getPlanDetectionPass';
import { lintPlanStructure } from '@/plan/lintPlanStructure';
import { writeJsonFile } from '@/common/utils/writeJsonFile';

const defaultGradeTimeoutMs = 30 * 60 * 1000;

interface Params {
	cwd: string;
	driver: Driver;
	/** Kebab plan name — the folder the plan's own files live in. */
	name: string;
	/** Supplemental code standards, threaded into the gap-check so standards-conflict can fire. */
	standards?: string;
	model?: string;
	effort?: Effort;
	permissions?: Permissions;
	timeoutMs?: number;
	onProgress?: (message: string) => void;
}

type RunPlanGradeResult =
	| { status: 'complete'; workspaceDir: string; grade: GradeReport; gradePath: string }
	| { status: 'failed'; workspaceDir: string; error: string }
	| { status: 'paused-rate-limit'; workspaceDir: string; error: string };

/**
 * Read-only detector for a plan's grade: a deterministic structural re-check
 * (the same `lintPlanStructure` the draft loop converged against — normally
 * clean here) plus an agent gap-check for decision-level gaps. The verdict is
 * A only when both the structural findings and the gaps are empty. It never
 * edits the plan — it detects and writes `grade.json`, the typed verdict the
 * ignition skill reads. A single plan is `.lightsout/plans/<name>/plan.md`; a
 * phased plan is `overview.md` as context plus each `phase<N>-<slug>.md` in that
 * same folder, gap-checked with the overview alongside.
 */
export const runPlanGrade = async ({
	cwd,
	driver,
	name,
	standards,
	model,
	effort,
	permissions,
	timeoutMs = defaultGradeTimeoutMs,
	onProgress,
}: Params): Promise<RunPlanGradeResult> => {
	const progress = onProgress ?? (() => undefined);
	const { workspaceDir, overviewText, files: phases, planPaths, config, error } = await getPlanDetectionPass({ cwd, name });

	if (error) {
		return { status: 'failed' as const, workspaceDir, error };
	}

	// Structural re-check covers every plan file, overview included (it has its
	// own required-section set).
	const structural = await lintPlanStructure({ cwd, planPaths, config });

	// Cheap advisory backstop for the Dedup Review phase: if planned symbols still
	// name-collide with existing exports, nudge — but never gate. Raw collisions
	// may be justified-distinct; the Dedup Review phase is the enforcement, not grade.
	const priorArtCandidates = await detectPriorArtCandidates({ cwd, planPaths, config });

	if (priorArtCandidates.length > 0) {
		progress(
			`plan grade ${name}: ${priorArtCandidates.length} planned symbol(s) still name-collide with existing exports — run \`lightsout plan dedup --name ${name}\``,
		);
	}

	progress(`plan grade ${name}: ${structural.length} structural finding(s), gap-checking ${phases.length} plan file(s)`);

	const gaps: PlanGap[] = [];
	const invokePlanAgent = createPlanAgentRunner({ cwd, driver, workspaceDir, step: 'grade', model, effort, permissions, timeoutMs });

	for (const phase of phases) {
		const outcome = await invokePlanAgent({
			invocation: buildPlanGapCheckInvocation({ planText: phase.text, overviewText, standards }),
			contract: GapCheckReport,
			label: basename(phase.path),
		});

		if (!outcome.ok) {
			return outcome.rateLimited
				? { status: 'paused-rate-limit' as const, workspaceDir, error: `rate limit reached — re-run: lightsout plan grade --name ${name}` }
				: { status: 'failed' as const, workspaceDir, error: `gap-check failed for ${basename(phase.path)}: ${outcome.failure}` };
		}

		gaps.push(...outcome.report.gaps);
	}

	const grade = structural.length === 0 && gaps.length === 0 ? PlanGrade.A : PlanGrade.BelowA;
	const report: GradeReport = {
		planName: name,
		grade,
		structural,
		gaps,
		passed: grade === PlanGrade.A,
		gradedAt: new Date().toISOString(),
	};
	const gradePath = join(workspaceDir, 'grade.json');

	await writeJsonFile({ path: gradePath, value: report });

	progress(`plan grade ${name}: ${grade} (${structural.length} structural, ${gaps.length} gap(s))`);

	return { status: 'complete' as const, workspaceDir, grade: report, gradePath };
};
