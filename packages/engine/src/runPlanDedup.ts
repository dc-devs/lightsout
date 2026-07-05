import { appendFile, mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { DedupJudgment, DedupReport, type DedupFinding } from '@lightsout/contracts';
import { buildPlanDedupInvocation } from '@lightsout/agents';
import type { Driver } from '@lightsout/drivers';
import { detectPriorArtCandidates } from './detectPriorArtCandidates';
import { invokeAgentWithContract } from './invokeAgentWithContract';
import { loadConfig } from './loadConfig';
import { planWorkspaceDir } from './planWorkspaceDir';

const defaultDedupTimeoutMs = 30 * 60 * 1000;

interface Params {
	cwd: string;
	driver: Driver;
	/** Kebab plan name — the workspace key and the deliverable's basename. */
	name: string;
	/** Resolved absolute directory where committed plan deliverables live. */
	plansDir: string;
	/** Supplemental code standards, threaded into the judge so extract/reuse recs can honor them. */
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

/** A plan file to judge: its path and text. The overview is passed as context, never judged standalone. */
interface PlanFile {
	path: string;
	text: string;
}

/**
 * Read-only prior-art detector for the interactive Dedup Review pass:
 * deterministically detect every planned new symbol that name-collides with an
 * existing export (reusing scan's tier-0 comparator), then have the judge agent
 * rule which are real duplicates and how to resolve each. It never edits the
 * plan — it detects, judges, and writes `dedup.json`, the typed findings the
 * ignition skill reads to conduct the human resolution. No candidates → no agent
 * call, an empty report. A single plan is `<plansDir>/<name>.md`; a phased plan
 * is `<plansDir>/<name>/*.md` where `overview.md` is context and each
 * `phase<N>-<slug>.md` is judged together.
 */
export const runPlanDedup = async ({
	cwd,
	driver,
	name,
	plansDir,
	standards,
	model,
	permissionMode,
	timeoutMs = defaultDedupTimeoutMs,
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
	const planFiles: PlanFile[] = [];

	if (await exists(singlePath)) {
		planFiles.push({ path: singlePath, text: await readFile(singlePath, 'utf8') });
	} else {
		const entries = (await readdir(phaseDir).catch(() => [] as string[])).filter((entry) => entry.endsWith('.md')).sort();

		for (const entry of entries) {
			const path = join(phaseDir, entry);
			const text = await readFile(path, 'utf8');

			if (entry === 'overview.md') {
				overviewPath = path;
				overviewText = text;
			} else {
				planFiles.push({ path, text });
			}
		}
	}

	if (planFiles.length === 0) {
		return {
			status: 'failed' as const,
			workspaceDir,
			error: `no plan found for '${name}' — expected ${singlePath} or ${phaseDir}/phase<N>-<slug>.md`,
		};
	}

	const planPaths = [...(overviewPath ? [overviewPath] : []), ...planFiles.map((file) => file.path)];
	const config = await loadConfig({ cwd }).catch(() => undefined);
	const candidates = await detectPriorArtCandidates({ cwd, planPaths, config });

	const writeReport = async (findings: DedupFinding[]) => {
		const dedup: DedupReport = { planName: name, findings, reviewedAt: new Date().toISOString() };
		const dedupPath = join(workspaceDir, 'dedup.json');

		await writeFile(dedupPath, `${JSON.stringify(dedup, undefined, '\t')}\n`, 'utf8');

		return { dedup, dedupPath };
	};

	// No candidates → no-op: an empty report, no agent call.
	if (candidates.length === 0) {
		progress(`plan dedup ${name}: no prior-art candidates — nothing to review`);

		const { dedup, dedupPath } = await writeReport([]);

		return { status: 'complete' as const, workspaceDir, dedup, dedupPath };
	}

	progress(`plan dedup ${name}: ${candidates.length} candidate(s) detected, judging`);

	const planText = planFiles.map((file) => file.text).join('\n\n');
	const { report, failure, rateLimited } = await invokeAgentWithContract({
		driver,
		cwd,
		invocation: buildPlanDedupInvocation({ planText, overviewText, candidates, standards }),
		contract: DedupJudgment,
		model,
		permissionMode,
		timeoutMs,
		onEvent: (event) => {
			void appendFile(join(workspaceDir, 'dedup-stream.jsonl'), `${JSON.stringify(event)}\n`, 'utf8').catch(() => undefined);
		},
		onRejectedOutput: async ({ text, attempt }) => {
			await writeFile(join(workspaceDir, `dedup-rejected-${attempt}.txt`), text, 'utf8').catch(() => undefined);
		},
	});

	if (rateLimited) {
		return {
			status: 'paused-rate-limit' as const,
			workspaceDir,
			error: `rate limit reached — re-run: lightsout plan dedup --name ${name}`,
		};
	}

	if (!report) {
		return { status: 'failed' as const, workspaceDir, error: `dedup judge failed: ${failure ?? 'unknown failure'}` };
	}

	// Join: each candidate whose verdict confirms a duplicate becomes a finding
	// (detected `collidesWith` + the agent's resolution, matched by `plannedSymbol`).
	const verdictBySymbol = new Map(report.verdicts.map((verdict) => [verdict.plannedSymbol, verdict]));
	const findings: DedupFinding[] = [];

	for (const candidate of candidates) {
		const verdict = verdictBySymbol.get(candidate.plannedSymbol);

		if (!verdict || !verdict.isDuplicate) {
			continue;
		}

		findings.push({
			plannedSymbol: candidate.plannedSymbol,
			plannedPath: candidate.plannedPath,
			collidesWith: candidate.collidesWith,
			recommendation: verdict.recommendation,
			rationale: verdict.rationale,
			suggestedLocation: verdict.suggestedLocation,
			migrateCallers: verdict.migrateCallers,
		});
	}

	const { dedup, dedupPath } = await writeReport(findings);

	progress(`plan dedup ${name}: ${findings.length} duplication(s) to review`);

	return { status: 'complete' as const, workspaceDir, dedup, dedupPath };
};
