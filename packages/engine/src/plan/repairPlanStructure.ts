import { join } from 'node:path';
import { buildPlanRepairInvocation } from '#src/agents/index.ts';
import { type Effort, type LightsoutConfig, type Permissions, PlanFixReport, PlanFixStatus, type StructuralFinding } from '#src/contracts/index.ts';
import type { Driver } from '#src/drivers/index.ts';
import { PlanRunStatus } from '#src/plan/common/constants/PlanRunStatus.ts';
import { createPlanAgentRunner } from '#src/plan/common/utils/createPlanAgentRunner.ts';
import { lintPlanStructure } from '#src/plan/lintPlanStructure.ts';

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
	/** Absolute path of the workspace's brainstorm-decisions.json when one exists — the repairer Reads it alongside the plan's own decisions. */
	brainstormDecisionsPath?: string;
	config?: LightsoutConfig;
	model?: string;
	effort?: Effort;
	permissions?: Permissions;
	timeoutMs: number;
	progress: (message: string) => void;
}

type RepairPlanStructureResult =
	| { status: typeof PlanRunStatus.Complete; findings: StructuralFinding[] }
	| { status: typeof PlanRunStatus.Failed; error: string }
	| { status: typeof PlanRunStatus.PausedRateLimit; error: string };

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
export const repairPlanStructure = async ({
	cwd,
	driver,
	name,
	planPaths,
	workspaceDir,
	brainstormDecisionsPath,
	config,
	model,
	effort,
	permissions,
	timeoutMs,
	progress,
}: Params): Promise<RepairPlanStructureResult> => {
	let findings = await lintPlanStructure({ cwd, planPaths, config });

	for (let repair = 1; repair <= maxRepairAttempts && findings.length > 0; repair += 1) {
		progress(`plan draft ${name}: ${findings.length} structural finding(s) — repair ${repair}/${maxRepairAttempts}`);

		const beforeKey = findingSetKey({ findings });

		// One runner per attempt, so each repair keeps its own transcript under the
		// name the workspace already uses.
		const invokePlanAgent = createPlanAgentRunner({ cwd, driver, workspaceDir, step: `repair-${repair}`, model, effort, permissions, timeoutMs });
		const outcome = await invokePlanAgent({
			invocation: buildPlanRepairInvocation({
				findings,
				planPaths,
				decisionsPath: join(workspaceDir, 'decisions.json'),
				brainstormDecisionsPath,
				factsPath: join(workspaceDir, 'facts.json'),
			}),
			contract: PlanFixReport,
		});

		if (!outcome.ok) {
			return outcome.rateLimited
				? { status: PlanRunStatus.PausedRateLimit, error: `rate limited or overloaded — re-run: lightsout plan draft --name ${name}` }
				: { status: PlanRunStatus.Failed, error: outcome.failure };
		}

		const { report } = outcome;

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

	return { status: PlanRunStatus.Complete, findings };
};
