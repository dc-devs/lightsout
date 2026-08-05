import { appendFile, mkdir, writeFile } from 'node:fs/promises';
import { isAbsolute, join } from 'node:path';
import { PlanDraftReport, PlanDraftStatus, PlanVariant, type Effort, type Permissions, type StructuralFinding } from '@/contracts';
import { buildPlanWriterInvocation } from '@/agents';
import type { Driver } from '@/drivers';
import { estimatePlanScope } from '@/plan/estimatePlanScope';
import { invokeAgentWithContract } from '@/invoke';
import { loadConfig } from '@/common/utils/loadConfig';
import { pathExists } from '@/plan/common/utils/pathExists';
import { planWorkspaceDir } from '@/plan/planWorkspaceDir';
import { readDecisions } from '@/plan/readDecisions';
import { readPlanFacts } from '@/plan/readPlanFacts';
import { repairPlanStructure } from '@/plan/repairPlanStructure';

const defaultDraftTimeoutMs = 30 * 60 * 1000;

interface Params {
	cwd: string;
	driver: Driver;
	/** Kebab plan name — the workspace key and the deliverable's basename. */
	name: string;
	/** Resolved absolute directory where committed plan deliverables live. */
	plansDir: string;
	/** Force a variant; otherwise it is estimated from the facts' touched-file count. */
	scope?: PlanVariant;
	/** Supplemental code standards, threaded into the plan-writer invocation. */
	standards?: string;
	model?: string;
	effort?: Effort;
	permissions?: Permissions;
	timeoutMs?: number;
	onProgress?: (message: string) => void;
}

type RunPlanDraftResult =
	| { status: 'complete'; workspaceDir: string; planPaths: string[]; variant: PlanVariant; report: PlanDraftReport }
	| { status: 'failed'; workspaceDir: string; error: string }
	| { status: 'paused-rate-limit'; workspaceDir: string; error: string }
	| { status: 'facts-error'; workspaceDir: string; discrepancies: string[] }
	| { status: 'structural-issues'; workspaceDir: string; findings: StructuralFinding[]; planPaths: string[] };

/**
 * Draft a structurally clean plan: a plan-writer agent authors the file(s) to
 * disk at the paths named in its prompt — once — then `repairPlanStructure`
 * lints the structure and converges any failures; survivors return as
 * `structural-issues` with the draft path intact. The engine owns the *path*
 * (told to the agent) and *verifies* the write; the agent owns the content. A
 * phased plan is a single spawn that authors `overview.md` plus every
 * `phase<N>-<slug>.md` into `<plansDir>/<name>/` (the agent chooses the
 * breakdown; the engine reads the paths back from the report and verifies each).
 * `plan draft` overwrites an existing deliverable — it is the from-scratch
 * authoring step, never re-run mid-convergence.
 */
export const runPlanDraft = async ({
	cwd,
	driver,
	name,
	plansDir,
	scope,
	standards,
	model,
	effort,
	permissions,
	timeoutMs = defaultDraftTimeoutMs,
	onProgress,
}: Params): Promise<RunPlanDraftResult> => {
	const progress = onProgress ?? (() => undefined);
	const workspaceDir = planWorkspaceDir({ cwd, name });

	await mkdir(workspaceDir, { recursive: true });

	const facts = await readPlanFacts({ cwd, name });
	const decisions = await readDecisions({ cwd, name });
	const config = await loadConfig({ cwd }).catch(() => undefined);
	const variant = scope ?? estimatePlanScope({ facts });

	// Single → one file at <plansDir>/<name>.md. Phased → the overview file
	// fronts the phase files the agent authors alongside it in <plansDir>/<name>/.
	const outputs =
		variant === PlanVariant.Single
			? [{ path: join(plansDir, `${name}.md`), variant: PlanVariant.Single }]
			: [{ path: join(plansDir, name, 'overview.md'), variant: PlanVariant.Overview }];

	await mkdir(variant === PlanVariant.Single ? plansDir : join(plansDir, name), { recursive: true });

	progress(`plan draft ${name}: variant ${variant} (${scope ? 'scope flag' : 'estimated'})`);

	// The writer self-lints in-session, where its context is already loaded — a
	// repair spawn re-reads everything it already knew. `process.argv[1]` is the
	// running CLI bundle, so the writer's subprocess resolves the identical
	// engine. The consumer-controlled paths are quoted (they may contain spaces);
	// the prefix stays unquoted in both the command and the grant, because the
	// harness's allowed-tools rule is a literal prefix match.
	const lintPrefix = `node ${process.argv[1]} plan lint`;
	const lintCommand = `${lintPrefix} --name ${name} --plans "${plansDir}" --cwd "${cwd}"`;

	const { report, failure, rateLimited } = await invokeAgentWithContract({
		driver,
		cwd,
		invocation: buildPlanWriterInvocation({ facts, decisions, outputs, standards, lintCommand }),
		contract: PlanDraftReport,
		model,
		effort,
		permissions,
		timeoutMs,
		allowedCommands: [lintPrefix],
		onEvent: (event) => {
			void appendFile(join(workspaceDir, 'draft-stream.jsonl'), `${JSON.stringify(event)}\n`, 'utf8').catch(() => undefined);
		},
		onRejectedOutput: async ({ text, attempt: reportAttempt }) => {
			await writeFile(join(workspaceDir, `draft-rejected-${reportAttempt}.txt`), text, 'utf8').catch(() => undefined);
		},
	});

	if (rateLimited) {
		return {
			status: 'paused-rate-limit' as const,
			workspaceDir,
			error: `rate limit reached — re-run: lightsout plan draft --name ${name}`,
		};
	}

	if (!report) {
		return { status: 'failed' as const, workspaceDir, error: failure ?? 'unknown failure' };
	}

	// A facts/decisions discrepancy the agent found is not a drafting bug — the
	// inputs are wrong. Surface it for the session to re-explore; never loop.
	if (report.status === PlanDraftStatus.Error) {
		return { status: 'facts-error' as const, workspaceDir, discrepancies: report.discrepancies };
	}

	const planPaths = report.filesWritten.map((file) => (isAbsolute(file.path) ? file.path : join(cwd, file.path)));
	const missing: string[] = [];

	for (const path of planPaths) {
		if (!(await pathExists({ path }))) {
			missing.push(path);
		}
	}

	if (planPaths.length === 0 || missing.length > 0) {
		return {
			status: 'failed' as const,
			workspaceDir,
			error:
				planPaths.length === 0
					? 'plan-writer reported drafted but listed no files written'
					: `plan-writer reported files that were not written: ${missing.join(', ')}`,
		};
	}

	const repaired = await repairPlanStructure({ cwd, driver, name, planPaths, workspaceDir, config, model, effort, permissions, timeoutMs, progress });

	if (repaired.status === 'paused-rate-limit') {
		return { status: 'paused-rate-limit' as const, workspaceDir, error: repaired.error };
	}

	if (repaired.status === 'failed') {
		return { status: 'failed' as const, workspaceDir, error: repaired.error };
	}

	if (repaired.findings.length > 0) {
		return { status: 'structural-issues' as const, workspaceDir, findings: repaired.findings, planPaths };
	}

	progress(`plan draft ${name}: structurally clean (${planPaths.length} file(s))`);

	return { status: 'complete' as const, workspaceDir, planPaths, variant, report };
};
