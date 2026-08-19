import { join } from 'node:path';
import { buildPlanDedupInvocation } from '@/agents';
import { writeJsonFile } from '@/common/utils/writeJsonFile';
import { type DedupFinding, DedupJudgment, type DedupReport, type Effort, type Permissions } from '@/contracts';
import type { Driver } from '@/drivers';
import { createPlanAgentRunner } from '@/plan/common/utils/createPlanAgentRunner';
import { getPlanDetectionPass } from '@/plan/common/utils/getPlanDetectionPass';
import { matchDedupVerdicts } from '@/plan/common/utils/matchDedupVerdicts';
import { detectPriorArtCandidates } from '@/plan/detectPriorArtCandidates';

interface Params {
	cwd: string;
	driver: Driver;
	/** Kebab plan name — the folder the plan's own files live in. */
	name: string;
	/** Supplemental code standards, threaded into the judge so extract/reuse recs can honor them. */
	standards?: string;
	model?: string;
	effort?: Effort;
	permissions?: Permissions;
	timeoutMs?: number;
	onProgress?: (message: string) => void;
}

type RunPlanDedupResult =
	| { status: 'complete'; workspaceDir: string; dedup: DedupReport; dedupPath: string }
	| { status: 'failed'; workspaceDir: string; error: string }
	| { status: 'paused-rate-limit'; workspaceDir: string; error: string };

/**
 * Read-only prior-art detector for the interactive Dedup Review pass:
 * deterministically detect every planned new symbol that name-collides with an
 * existing export (reusing the standards check's tier-0 comparator), then have
 * the judge agent rule which are real duplicates and how to resolve each. It
 * never edits the plan — it detects, judges, and writes `dedup.json`, the typed
 * findings the ignition skill reads to conduct the human resolution. No
 * candidates → no agent call, an empty report. A single plan is
 * `.lightsout/plans/<name>/plan.md`; a phased plan is `overview.md` as context
 * plus each `phase<N>-<slug>.md` in that same folder, judged together.
 */
export const runPlanDedup = async ({
	cwd,
	driver,
	name,
	standards,
	model,
	effort,
	permissions,
	timeoutMs = 30 * 60 * 1000,
	onProgress,
}: Params): Promise<RunPlanDedupResult> => {
	const progress = onProgress ?? (() => undefined);
	const { workspaceDir, overviewText, files: planFiles, planPaths, config, error } = await getPlanDetectionPass({ cwd, name });

	if (error) {
		return { status: 'failed' as const, workspaceDir, error };
	}

	const candidates = await detectPriorArtCandidates({ cwd, planPaths, config });

	const writeReport = async (findings: DedupFinding[]) => {
		const dedup: DedupReport = { planName: name, findings, reviewedAt: new Date().toISOString() };
		const dedupPath = join(workspaceDir, 'dedup.json');

		await writeJsonFile({ path: dedupPath, value: dedup });

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
	const invokePlanAgent = createPlanAgentRunner({ cwd, driver, workspaceDir, step: 'dedup', model, effort, permissions, timeoutMs });
	const outcome = await invokePlanAgent({
		invocation: buildPlanDedupInvocation({ planText, overviewText, candidates, standards }),
		contract: DedupJudgment,
	});

	if (!outcome.ok) {
		return outcome.rateLimited
			? { status: 'paused-rate-limit' as const, workspaceDir, error: `rate limited or overloaded — re-run: lightsout plan dedup --name ${name}` }
			: { status: 'failed' as const, workspaceDir, error: `dedup judge failed: ${outcome.failure}` };
	}

	const { report } = outcome;

	const findings = matchDedupVerdicts({ candidates, verdicts: report.verdicts });
	const { dedup, dedupPath } = await writeReport(findings);

	progress(`plan dedup ${name}: ${findings.length} duplication(s) to review`);

	return { status: 'complete' as const, workspaceDir, dedup, dedupPath };
};
