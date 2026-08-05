import { appendFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { PlanFixReport, PlanFixStatus, type Effort, type LightsoutConfig, type Permissions, type StructuralFinding } from '@lightsout/contracts';
import { buildPlanRepairInvocation } from '@lightsout/agents';
import type { Driver } from '@lightsout/drivers';
import { invokeAgentWithContract } from '../invoke';
import { lintPlanStructure } from './lintPlanStructure';

const maxRepairAttempts = 3;

interface Params {
	cwd: string;
	driver: Driver;
	/** Kebab plan name — narrated in progress lines and in the parked re-run command. */
	name: string;
	/** Absolute paths to the drafted plan file(s) the repairer may edit in place. */
	planPaths: string[];
	/** The plan's workspace dir: repair transcripts land here, as do the facts/decisions the repairer is pointed at. */
	workspaceDir: string;
	config?: LightsoutConfig;
	model?: string;
	effort?: Effort;
	permissions?: Permissions;
	timeoutMs: number;
	progress: (message: string) => void;
}

type RepairPlanStructureResult =
	| { status: 'complete'; findings: StructuralFinding[] }
	| { status: 'failed'; error: string }
	| { status: 'paused-rate-limit'; error: string };

/**
 * The finding set as a comparable multiset key. `location` is deliberately
 * excluded: it carries a line number, and a repair edit earlier in the file
 * shifts every later finding's line — a stuck finding that merely drifted would
 * read as progress. `issue` already names the specifics.
 */
const findingSetKey = ({ findings }: { findings: StructuralFinding[] }) =>
	findings
		.map((finding) => [finding.check, finding.issue].join('|'))
		.sort()
		.join('\n');

/**
 * Lint a drafted plan's structure and converge it: each lint failure is
 * corrected by a small repair invocation that Edits the draft in place against
 * the typed findings (the `invokeAgentWithContract` re-emit philosophy applied
 * at the lint level), re-linting after each, capped at 3 repairs. A `complete`
 * result carries the surviving findings — empty when the plan converged — so
 * the caller decides what a survivor means.
 */
export const repairPlanStructure = async ({ cwd, driver, name, planPaths, workspaceDir, config, model, effort, permissions, timeoutMs, progress }: Params): Promise<RepairPlanStructureResult> => {
	let findings = await lintPlanStructure({ cwd, planPaths, config });

	for (let repair = 1; repair <= maxRepairAttempts && findings.length > 0; repair += 1) {
		progress(`plan draft ${name}: ${findings.length} structural finding(s) — repair ${repair}/${maxRepairAttempts}`);

		const beforeKey = findingSetKey({ findings });

		const { report, failure, rateLimited } = await invokeAgentWithContract({
			driver,
			cwd,
			invocation: buildPlanRepairInvocation({
				findings,
				planPaths,
				decisionsPath: join(workspaceDir, 'decisions.json'),
				factsPath: join(workspaceDir, 'facts.json'),
			}),
			contract: PlanFixReport,
			model,
			effort,
			permissions,
			timeoutMs,
			onEvent: (event) => {
				void appendFile(join(workspaceDir, `repair-${repair}-stream.jsonl`), `${JSON.stringify(event)}\n`, 'utf8').catch(() => undefined);
			},
			onRejectedOutput: async ({ text, attempt: reportAttempt }) => {
				await writeFile(join(workspaceDir, `repair-rejected-${repair}-${reportAttempt}.txt`), text, 'utf8').catch(() => undefined);
			},
		});

		if (rateLimited) {
			return { status: 'paused-rate-limit' as const, error: `rate limit reached — re-run: lightsout plan draft --name ${name}` };
		}

		if (!report) {
			return { status: 'failed' as const, error: failure ?? 'unknown failure' };
		}

		// The repairer found a finding unresolvable from its inputs — narrate the
		// declines, then fall through to the re-lint below and stop: it may have
		// fixed other findings before declining, so the surviving set must come
		// from the lint, never from the stale pre-repair list. The survivors
		// return to the session, which fixes them via conductor Edit (the
		// Grade-step pattern).
		const declined = report.status === PlanFixStatus.Error;

		if (declined) {
			for (const discrepancy of report.discrepancies) {
				progress(`plan draft ${name}: repair declined — ${discrepancy}`);
			}
		}

		// A repaired file the agent deleted or broke re-surfaces here — the lint
		// reports an unreadable plan file as a finding.
		findings = await lintPlanStructure({ cwd, planPaths, config });

		if (declined) {
			break;
		}

		// Every repair round gets identical inputs, so a finding set that came
		// back unchanged predicts an unchanged retry — spend the remaining
		// attempts on nothing and the survivors still land in the session's lap.
		// They return as structural-issues either way, and grade re-runs the same
		// lint, so nothing is hidden by stopping early.
		if (findings.length > 0 && findingSetKey({ findings }) === beforeKey) {
			progress(`plan draft ${name}: repair ${repair} made no progress — stopping`);

			break;
		}
	}

	return { status: 'complete' as const, findings };
};
