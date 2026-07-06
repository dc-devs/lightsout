import { appendFile, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { GapCheckReport, GradeReport, PlanGrade, type PlanGap, type StructuralFinding } from '@lightsout/contracts';
import { buildPlanGapCheckInvocation } from '@lightsout/agents';
import type { Driver } from '@lightsout/drivers';
import { detectPriorArtCandidates } from './detectPriorArtCandidates';
import { invokeAgentWithContract } from '../invoke';
import { lintPlanStructure } from './lintPlanStructure';
import { loadConfig } from '../common/utils/loadConfig';
import { pathExists } from './common/utils/pathExists';
import { planWorkspaceDir } from './planWorkspaceDir';

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
	permissionMode?: string;
	timeoutMs?: number;
	onProgress?: (message: string) => void;
}

/** A phase to gap-check: its path and text. The overview is passed as context, never graded standalone. */
interface Phase {
	path: string;
	text: string;
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
	permissionMode,
	timeoutMs = defaultGradeTimeoutMs,
	onProgress,
}: Params) => {
	const progress = onProgress ?? (() => undefined);
	const workspaceDir = planWorkspaceDir({ cwd, name });

	await mkdir(workspaceDir, { recursive: true });

	// Resolve the deliverable: single file if present, else the phased directory.
	const singlePath = join(plansDir, `${name}.md`);
	const phaseDir = join(plansDir, name);

	let overviewPath: string | undefined;
	let overviewText: string | undefined;
	const phases: Phase[] = [];

	if (await pathExists({ path: singlePath })) {
		phases.push({ path: singlePath, text: await readFile(singlePath, 'utf8') });
	} else {
		const entries = (await readdir(phaseDir).catch(() => [] as string[])).filter((entry) => entry.endsWith('.md')).sort();

		for (const entry of entries) {
			const path = join(phaseDir, entry);
			const text = await readFile(path, 'utf8');

			if (entry === 'overview.md') {
				overviewPath = path;
				overviewText = text;
			} else {
				phases.push({ path, text });
			}
		}
	}

	if (phases.length === 0) {
		return {
			status: 'failed' as const,
			workspaceDir,
			error: `no plan found for '${name}' — expected ${singlePath} or ${phaseDir}/phase<N>-<slug>.md`,
		};
	}

	// Structural re-check covers every plan file, overview included (it has its
	// own required-section set).
	const planPaths = [...(overviewPath ? [overviewPath] : []), ...phases.map((phase) => phase.path)];
	const config = await loadConfig({ cwd }).catch(() => undefined);
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
			permissionMode,
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

	const structuralFindings: StructuralFinding[] = structural;
	const grade = structuralFindings.length === 0 && gaps.length === 0 ? PlanGrade.A : PlanGrade.BelowA;
	const report: GradeReport = {
		planName: name,
		grade,
		structural: structuralFindings,
		gaps,
		passed: grade === PlanGrade.A,
		gradedAt: new Date().toISOString(),
	};
	const gradePath = join(workspaceDir, 'grade.json');

	await writeFile(gradePath, `${JSON.stringify(report, undefined, '\t')}\n`, 'utf8');

	progress(`plan grade ${name}: ${grade} (${structuralFindings.length} structural, ${gaps.length} gap(s))`);

	return { status: 'complete' as const, workspaceDir, grade: report, gradePath };
};
