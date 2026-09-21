import { getStringFlag } from '#src/cli/common/args/getStringFlag.ts';
import { usage } from '#src/cli/common/constants/usage.ts';
import type { CommandContext } from '#src/cli/common/types/CommandContext.ts';
import { ensurePlanWorkspace } from '#src/cli/common/utils/ensurePlanWorkspace.ts';
import { resolvePlanTarget } from '#src/cli/common/utils/resolvePlanTarget.ts';
import { planNameFromPath } from '#src/plan/index.ts';
import { readTicketRunTerms, type TicketRunTerms } from '#src/ticket/index.ts';

interface Params {
	flags: CommandContext['flags'];
	/** The checkout the command was launched from. */
	cwd: string;
}

/**
 * What the run's flags amount to once they have been read and checked against
 * each other, or the one message saying why they cannot amount to a run.
 *
 * The checks live together because none of them stands alone: whether
 * `--overview`, `--packages` and `--start-phase` are allowed depends on what
 * `--plan` turned out to point at, and the order is what makes the message name
 * the first real problem rather than a cascade.
 *
 * Every check here reads the LAUNCHING checkout, and every one of them runs
 * before a workspace is resolved: no worktree may be created for a flag
 * combination that is going to be refused.
 *
 * The ticket record's own refusal is read here for the same reason: a plan the
 * ticket says may not be built yet must be refused before a tree is cut and
 * before the tracker is told the ticket has started.
 */
export const resolveImplementInputs = async ({
	flags,
	cwd,
}: Params): Promise<
	| { error: string }
	| {
			planPath: string;
			overviewPath: string | undefined;
			packages: string[] | undefined;
			startPhase: number | undefined;
			planName: string | undefined;
			shipRequest: TicketRunTerms['shipRequest'];
	  }
> => {
	const planPath = getStringFlag({ flags, name: 'plan' });
	const overviewPath = getStringFlag({ flags, name: 'overview' });
	const packagesFlag = getStringFlag({ flags, name: 'packages' });
	const startPhaseFlag = getStringFlag({ flags, name: 'start-phase' });
	const packages = packagesFlag
		? packagesFlag
				.split(',')
				.map((name) => name.trim())
				.filter(Boolean)
		: undefined;

	if (!planPath) {
		return { error: usage };
	}

	const startPhase = startPhaseFlag === undefined ? undefined : Number.parseInt(startPhaseFlag, 10);

	if (startPhase !== undefined && (!Number.isFinite(startPhase) || startPhase < 1)) {
		return { error: `--start-phase must be a positive integer, got '${startPhaseFlag}'` };
	}

	// The fetch has to have happened before anything asks the disk what shape the
	// plan is.
	const ensured = await ensurePlanWorkspace({ cwd, planPath });

	if (ensured !== undefined) {
		return { error: ensured.error };
	}

	const target = await resolvePlanTarget({ cwd, planPath });

	if ('error' in target) {
		return { error: target.error };
	}

	const phased = 'overviewPath' in target;

	if (phased && overviewPath !== undefined) {
		return { error: '--overview applies to a single-plan run — a plan folder with an overview.md already runs every phase' };
	}

	if (phased && packages !== undefined) {
		return { error: '--packages applies to a single-plan run — every phase of a plan folder reads its own scope' };
	}

	if (!phased && startPhase !== undefined) {
		return { error: '--start-phase applies to a plan folder holding an overview.md — a single plan has one phase' };
	}

	const planName = await planNameFromPath({ cwd, planPath });
	const terms = await readTicketRunTerms({ cwd, name: planName, planPath: 'overviewPath' in target ? target.overviewPath : target.planPath });

	if (terms.refusal !== undefined) {
		return { error: terms.refusal };
	}

	return { planPath, overviewPath, packages, startPhase, planName, shipRequest: terms.shipRequest };
};
