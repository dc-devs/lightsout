import { appendFile, mkdir, stat, writeFile } from 'node:fs/promises';
import { isAbsolute, join } from 'node:path';
import { PlanDraftReport, PlanDraftStatus, PlanVariant, type StructuralFinding } from '@lightsout/contracts';
import { buildPlanWriterInvocation } from '@lightsout/agents';
import type { Driver } from '@lightsout/drivers';
import { estimatePlanScope } from './estimatePlanScope';
import { invokeAgentWithContract } from '../invoke';
import { lintPlanStructure } from './lintPlanStructure';
import { loadConfig } from '../common/utils/loadConfig';
import { planWorkspaceDir } from './planWorkspaceDir';
import { readDecisions } from './readDecisions';
import { readPlanFacts } from './readPlanFacts';

const defaultDraftTimeoutMs = 30 * 60 * 1000;
const maxDraftAttempts = 5;

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
	permissionMode?: string;
	timeoutMs?: number;
	onProgress?: (message: string) => void;
}

const exists = (path: string) =>
	stat(path).then(
		() => true,
		() => false,
	);

/**
 * Draft a structurally clean plan: a plan-writer agent authors the file(s) to
 * disk at the paths named in its prompt, then deterministic engine code lints
 * the structure and re-invokes the agent with the findings as corrective input
 * until the lint is clean — capped at 5 attempts. The engine owns the *path*
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
	permissionMode,
	timeoutMs = defaultDraftTimeoutMs,
	onProgress,
}: Params) => {
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

	let findings: StructuralFinding[] = [];
	let planPaths: string[] = [];
	let lastReport: PlanDraftReport | undefined;

	for (let attempt = 1; attempt <= maxDraftAttempts; attempt += 1) {
		progress(`plan draft ${name}: attempt ${attempt}/${maxDraftAttempts}`);

		const { report, failure, rateLimited } = await invokeAgentWithContract({
			driver,
			cwd,
			invocation: buildPlanWriterInvocation({ facts, decisions, outputs, standards, findings: findings.length > 0 ? findings : undefined }),
			contract: PlanDraftReport,
			model,
			permissionMode,
			timeoutMs,
			onEvent: (event) => {
				void appendFile(join(workspaceDir, 'draft-stream.jsonl'), `${JSON.stringify(event)}\n`, 'utf8').catch(() => undefined);
			},
			onRejectedOutput: async ({ text, attempt: reportAttempt }) => {
				await writeFile(join(workspaceDir, `draft-rejected-${attempt}-${reportAttempt}.txt`), text, 'utf8').catch(() => undefined);
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

		lastReport = report;

		// A facts/decisions discrepancy the agent found is not a drafting bug — the
		// inputs are wrong. Surface it for the session to re-explore; never loop.
		if (report.status === PlanDraftStatus.Error) {
			return { status: 'facts-error' as const, workspaceDir, discrepancies: report.discrepancies };
		}

		planPaths = report.filesWritten.map((file) => (isAbsolute(file.path) ? file.path : join(cwd, file.path)));

		const missing: string[] = [];

		for (const path of planPaths) {
			if (!(await exists(path))) {
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

		findings = await lintPlanStructure({ cwd, planPaths, config });

		if (findings.length === 0) {
			progress(`plan draft ${name}: structurally clean (${planPaths.length} file(s))`);
			break;
		}

		progress(`plan draft ${name}: ${findings.length} structural finding(s) — re-drafting`);
	}

	if (findings.length > 0) {
		return { status: 'structural-issues' as const, workspaceDir, findings, planPaths };
	}

	return { status: 'complete' as const, workspaceDir, planPaths, variant, report: lastReport };
};
