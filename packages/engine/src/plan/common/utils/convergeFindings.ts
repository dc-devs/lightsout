import { type PlanFixReport, PlanFixStatus, type StructuralFinding } from '#src/contracts/index.ts';
import type { AgentOutcome } from '#src/invoke/index.ts';
import { maxPlanRepairAttempts } from '#src/plan/common/constants/maxPlanRepairAttempts.ts';
import { PlanRunStatus } from '#src/plan/common/constants/PlanRunStatus.ts';
import type { PlanRepairResult } from '#src/plan/common/types/PlanRepairResult.ts';
import { getBlockingFindings } from '#src/plan/common/utils/getBlockingFindings.ts';
import { getFindingSetKey } from '#src/plan/common/utils/getFindingSetKey.ts';

interface Params {
	/** Kebab plan name — narrated in progress lines and in the parked re-run command. */
	name: string;
	/** What this loop calls one round, in progress lines: `repair`, `reshape`. */
	verb: string;
	/** What this loop calls what it is converging, in progress lines: `structural finding(s)`. */
	findingNoun: string;
	/** Re-read what is on disk and report it. `undefined` means the files could not be read at all. */
	check: () => Promise<StructuralFinding[] | undefined>;
	/** The failure a `check` returning `undefined` ends the loop with. */
	unreadableError: string;
	/** Spawn one correcting agent against the blocking findings; it edits the files in place. */
	runAttempt: (params: { findings: StructuralFinding[]; attempt: number }) => Promise<AgentOutcome<PlanFixReport>>;
	progress: (message: string) => void;
}

/**
 * The bargain both plan-repair loops strike: check, spawn one correcting agent
 * against the blocking findings, re-check, and repeat until clean or until
 * `maxPlanRepairAttempts` is spent — then hand the survivors back to the
 * session. Only BLOCKING findings drive the loop and reach the agent: an
 * advisory is not a defect and must never consume one of those attempts. A
 * `complete` result carries the full surviving set, advisories included, so the
 * caller can print them.
 *
 * Spelled once because the structural repair and the phase-breakdown reshape
 * differ only in which check they re-read with and which agent they spawn —
 * everything load-bearing about the loop is the same bargain, and two copies of
 * it are two chances for one to quietly stop honouring a decline or an
 * unchanged finding set.
 */
export const convergeFindings = async ({ name, verb, findingNoun, check, unreadableError, runAttempt, progress }: Params): Promise<PlanRepairResult> => {
	const unreadable = { status: PlanRunStatus.Failed, error: unreadableError } as const;

	let findings = await check();

	if (findings === undefined) {
		return unreadable;
	}

	for (let attempt = 1; attempt <= maxPlanRepairAttempts && getBlockingFindings({ findings }).length > 0; attempt += 1) {
		const blocking = getBlockingFindings({ findings });

		progress(`plan draft ${name}: ${blocking.length} ${findingNoun} — ${verb} ${attempt}/${maxPlanRepairAttempts}`);

		const beforeKey = getFindingSetKey({ findings });
		const outcome = await runAttempt({ findings: blocking, attempt });

		if (!outcome.ok) {
			return outcome.rateLimited
				? { status: PlanRunStatus.PausedRateLimit, error: `rate limited or overloaded — re-run: lightsout plan draft --name ${name}` }
				: { status: PlanRunStatus.Failed, error: outcome.failure };
		}

		// The agent found a finding unresolvable from its inputs — narrate the
		// declines, then fall through to the re-check below and stop: it may have
		// fixed other findings before declining, so the surviving set must come
		// from the check, never from the stale pre-attempt list. The survivors
		// return to the session, which fixes them via conductor Edit (the
		// Grade-step pattern).
		const declined = outcome.report.status === PlanFixStatus.Error;

		if (declined) {
			for (const discrepancy of outcome.report.discrepancies) {
				progress(`plan draft ${name}: ${verb} declined — ${discrepancy}`);
			}
		}

		// A file the agent deleted or broke re-surfaces here — the check reports
		// an unreadable plan file rather than passing it over.
		findings = await check();

		if (findings === undefined) {
			return unreadable;
		}

		if (declined) {
			break;
		}

		// Every round gets identical inputs, so a finding set that came back
		// unchanged predicts an unchanged retry — spend the remaining attempts on
		// nothing and the survivors still land in the session's lap. They return
		// as structural-issues either way, and grade re-runs the same checks, so
		// nothing is hidden by stopping early.
		if (getBlockingFindings({ findings }).length > 0 && getFindingSetKey({ findings }) === beforeKey) {
			progress(`plan draft ${name}: ${verb} ${attempt} made no progress — stopping`);

			break;
		}
	}

	return { status: PlanRunStatus.Complete, findings };
};
