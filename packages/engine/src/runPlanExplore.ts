import { appendFile, mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { ExploreReport, type PlanFacts } from '@lightsout/contracts';
import { buildPlanExploreInvocation } from '@lightsout/agents';
import type { Driver } from '@lightsout/drivers';
import { invokeAgentWithContract } from './invokeAgentWithContract';
import { planWorkspaceDir } from './planWorkspaceDir';
import { verifyFacts } from './verifyFacts';

const defaultExploreTimeoutMs = 30 * 60 * 1000;

interface Params {
	cwd: string;
	driver: Driver;
	/** The feature description. */
	request: string;
	/** Kebab plan name — the workspace key. */
	name: string;
	/** One explorer per entry. Defaults to a single explorer over the request. */
	areas?: string[];
	model?: string;
	permissionMode?: string;
	timeoutMs?: number;
	onProgress?: (message: string) => void;
}

/**
 * Gather codebase facts for a plan: one explorer agent per area (bounded, ≤ 3),
 * then DETERMINISTIC verification of every returned path/script on disk before
 * persisting `facts.json`. Agents propose facts; code verifies them — that
 * verification is what lets a fresh-context agent implement the plan without
 * guessing. Partial-failure tolerant: as long as one explorer succeeds, its
 * facts are kept and the failed areas are narrated so the session can re-run
 * explore for the gap. A rate-limited explorer parks the run (explore is cheap
 * and idempotent — a re-run re-does all areas).
 */
export const runPlanExplore = async ({
	cwd,
	driver,
	request,
	name,
	areas,
	model,
	permissionMode,
	timeoutMs = defaultExploreTimeoutMs,
	onProgress,
}: Params) => {
	const progress = onProgress ?? (() => undefined);
	const workspaceDir = planWorkspaceDir({ cwd, name });

	await mkdir(workspaceDir, { recursive: true });

	const targetAreas = areas && areas.length > 0 ? areas : [request];

	progress(`plan explore ${name}: ${targetAreas.length} explorer(s)`);

	const results = await Promise.all(
		targetAreas.map(async (area, index) => {
			const outcome = await invokeAgentWithContract({
				driver,
				cwd,
				invocation: buildPlanExploreInvocation({ request, area }),
				contract: ExploreReport,
				model,
				permissionMode,
				timeoutMs,
				onEvent: (event) => {
					void appendFile(join(workspaceDir, `explore-${index}-stream.jsonl`), `${JSON.stringify(event)}\n`, 'utf8').catch(() => undefined);
				},
				onRejectedOutput: async ({ text, attempt }) => {
					await writeFile(join(workspaceDir, `explore-${index}-rejected-${attempt}.txt`), text, 'utf8').catch(() => undefined);
				},
			});

			return { area, ...outcome };
		}),
	);

	if (results.some((result) => result.rateLimited)) {
		return {
			status: 'paused-rate-limit' as const,
			workspaceDir,
			error: `rate limit reached — re-run: lightsout plan explore "${request}" --name ${name}`,
		};
	}

	const succeeded = results.filter((result) => result.report);
	const failed = results.filter((result) => !result.report);

	if (succeeded.length === 0) {
		return {
			status: 'failed' as const,
			workspaceDir,
			error: `all ${targetAreas.length} explorer(s) failed: ${failed.map((result) => result.failure).join('; ')}`,
		};
	}

	for (const result of failed) {
		progress(`plan explore · area '${result.area}' failed: ${result.failure} — re-run explore for it if the plan needs it`);
	}

	const mergedAreas = succeeded.flatMap((result) => result.report?.areas ?? []);
	const verification = await verifyFacts({ cwd, report: { areas: mergedAreas } });
	const facts: PlanFacts = {
		request,
		areas: mergedAreas,
		verification,
		verifiedAt: new Date().toISOString(),
	};
	const factsPath = join(workspaceDir, 'facts.json');

	await writeFile(factsPath, `${JSON.stringify(facts, undefined, '\t')}\n`, 'utf8');

	const missingPart = verification.missingPaths.length > 0 ? `, ${verification.missingPaths.length} missing: ${verification.missingPaths.join(', ')}` : '';

	progress(
		`plan explore · ${verification.pathsChecked} path(s) verified${missingPart}; ${verification.scriptsChecked} script(s) checked, ${verification.missingScripts.length} missing`,
	);

	return { status: 'complete' as const, facts, factsPath, workspaceDir, error: undefined };
};
