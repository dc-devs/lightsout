import { appendFile, writeFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { GapCheckReport, GradeReport, PlanGrade, type Effort, type Permissions, type PlanGap } from '@lightsout/contracts';
import { buildPlanGapCheckInvocation } from '@lightsout/agents';
import type { Driver } from '@lightsout/drivers';
import { detectPriorArtCandidates } from './detectPriorArtCandidates';
import { getPlanDetectionPass } from './common/utils/getPlanDetectionPass';
import { invokeAgentWithContract } from '../invoke';
import { lintPlanStructure } from './lintPlanStructure';
import { writeJsonFile } from '../common/utils/writeJsonFile';

const defaultGradeTimeoutMs = 30 * 60 * 1000;

interface Params {
	cwd: string;
	driver: Driver;
	/** Kebab plan name — the workspace key and the deliverable's basename. */
	name: string;
	/** Resolved absolute directory where committed plan deliverables live. */
	plansDir: string;
	/** Supplemental code standards, threaded into the gap-check so standards-conflict can fire. */
	standards?: string;
	model?: string;
	effort?: Effort;
	permissions?: Permissions;
	timeoutMs?: number;
	onProgress?: (message: string) => void;
}

/**
 * Read-only detector for a plan's grade: a deterministic structural re-check
 * (the same `lintPlanStructure` the draft loop converged against — normally
 * clean here) plus an agent gap-check for decision-level gaps. The verdict is
 * A only when both the structural findings and the gaps are empty. It never
 * edits the plan — it detects and writes `grade.json`, the typed verdict the
 * ignition skill reads. A single plan is `<plansDir>/<name>.md`; a phased plan
 * is `<plansDir>/<name>/*.md` where `overview.md` is context and each
 * `phase<N>-<slug>.md` is gap-checked with the overview alongside.
 */
export const runPlanGrade = async ({
	cwd,
	driver,
	name,
	plansDir,
	standards,
	model,
	effort,
	permissions,
	timeoutMs = defaultGradeTimeoutMs,
	onProgress,
}: Params) => {
	const progress = onProgress ?? (() => undefined);
	const { workspaceDir, overviewText, files: phases, planPaths, config, error } = await getPlanDetectionPass({ cwd, name, plansDir });

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

	for (const phase of phases) {
		const { report, failure, rateLimited } = await invokeAgentWithContract({
			driver,
			cwd,
			invocation: buildPlanGapCheckInvocation({ planText: phase.text, overviewText, standards }),
			contract: GapCheckReport,
			model,
			effort,
			permissions,
			timeoutMs,
			onEvent: (event) => {
				void appendFile(join(workspaceDir, 'grade-stream.jsonl'), `${JSON.stringify(event)}\n`, 'utf8').catch(() => undefined);
			},
			onRejectedOutput: async ({ text, attempt }) => {
				await writeFile(join(workspaceDir, `grade-rejected-${basename(phase.path)}-${attempt}.txt`), text, 'utf8').catch(() => undefined);
			},
		});

		if (rateLimited) {
			return {
				status: 'paused-rate-limit' as const,
				workspaceDir,
				error: `rate limit reached — re-run: lightsout plan grade --name ${name}`,
			};
		}

		if (!report) {
			return { status: 'failed' as const, workspaceDir, error: `gap-check failed for ${basename(phase.path)}: ${failure ?? 'unknown failure'}` };
		}

		gaps.push(...report.gaps);
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
