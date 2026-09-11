import { getListFlag } from '#src/cli/common/args/getListFlag.ts';
import { getPositionals } from '#src/cli/common/args/getPositionals.ts';
import { getRequiredFlag } from '#src/cli/common/args/getRequiredFlag.ts';
import { getStringFlag } from '#src/cli/common/args/getStringFlag.ts';
import { usage } from '#src/cli/common/constants/usage.ts';
import { printPlanTicketWarning } from '#src/cli/common/render/printPlanTicketWarning.ts';
import type { CommandContext } from '#src/cli/common/types/CommandContext.ts';
import { exitCli } from '#src/cli/common/utils/exitCli.ts';
import { resolveConfigAndDriver } from '#src/cli/common/utils/resolveConfigAndDriver.ts';
import { openPlanWorktree } from '#src/cli/plan/common/utils/openPlanWorktree.ts';
import { planDedupCommand } from '#src/cli/plan/planDedupCommand.ts';
import { planDraftCommand } from '#src/cli/plan/planDraftCommand.ts';
import { planGradeCommand } from '#src/cli/plan/planGradeCommand.ts';
import { planLintCommand } from '#src/cli/plan/planLintCommand.ts';
import { planPublishCommand } from '#src/cli/plan/planPublishCommand.ts';
import { planSyncDecisionsCommand } from '#src/cli/plan/planSyncDecisionsCommand.ts';
import { planVerifyFactsCommand } from '#src/cli/plan/planVerifyFactsCommand.ts';
import { planWorkspaceCommand } from '#src/cli/plan/planWorkspaceCommand.ts';
import { readPlanningStandards } from '#src/cli/plan/readPlanningStandards.ts';
import { readOptionalConfig } from '#src/common/config/readOptionalConfig.ts';

/**
 * The checkout a subcommand acts on — the plan's worktree for every subcommand
 * that addresses a plan by name, the launching checkout otherwise — with the
 * ticket advisory said once, against that same checkout.
 *
 * This is the one place a resolver refusal is handled, for every subcommand
 * alike: no subcommand can be dispatched without a checkout to act on, so the
 * sentence goes to stderr and the process exits 1 with nothing dispatched. An
 * unknown subcommand is excluded, so it still falls through to the usage error
 * with nothing printed ahead of it, and a nameless one reaches its own refusal
 * unchanged. The config read is the launching checkout's, so an uncommitted
 * `plan.worktree` edit is still obeyed.
 */
const openDispatchCheckout = async ({ cwd, flags, subcommand }: { cwd: string; flags: CommandContext['flags']; subcommand: string | undefined }) => {
	const name = getStringFlag({ flags, name: 'name' });

	if (name === undefined || !['workspace', 'draft', 'dedup', 'grade', 'lint', 'publish', 'sync-decisions', 'verify-facts'].includes(subcommand ?? '')) {
		return { cwd, worktree: undefined };
	}

	const opened = await openPlanWorktree({ cwd, config: await readOptionalConfig({ cwd }), flags, name });

	if ('error' in opened) {
		console.error(opened.error);
		return exitCli({ code: 1 });
	}

	await printPlanTicketWarning({ cwd: opened.worktree.cwd, name });

	return { cwd: opened.worktree.cwd, worktree: opened.worktree };
};

export const planCommand = async ({ flags, rest, cwd: launchingCwd }: CommandContext): Promise<void> => {
	const subcommand = getPositionals({ args: rest })[0];

	// `workspace` has no --name refusal of its own further down, so a nameless
	// one is refused here — before any tree is established for it.
	if (subcommand === 'workspace') {
		await getRequiredFlag({ flags, name: 'name' });
	}

	const { cwd, worktree } = await openDispatchCheckout({ cwd: launchingCwd, flags, subcommand });

	if (subcommand === 'workspace' && worktree !== undefined) {
		await planWorkspaceCommand({ worktree });
		return;
	}

	// verify-facts is deterministic — no agent, so no resolveConfigAndDriver.
	if (subcommand === 'verify-facts') {
		await planVerifyFactsCommand({ flags, rest, cwd });
		return;
	}

	// lint is deterministic — no agent, so no resolveConfigAndDriver.
	if (subcommand === 'lint') {
		await planLintCommand({ flags, rest, cwd });
		return;
	}

	// sync-decisions spawns no agent either — it re-renders the Decision Log from
	// the saved records and writes the plan files, so it needs no driver.
	if (subcommand === 'sync-decisions') {
		await planSyncDecisionsCommand({ flags, rest, cwd });
		return;
	}

	// publish spawns no agent either — it reads the plan folder and talks to the
	// tracker, so it needs no driver.
	if (subcommand === 'publish') {
		await planPublishCommand({ flags, rest, cwd });
		return;
	}

	if (subcommand === 'draft' || subcommand === 'dedup' || subcommand === 'grade') {
		const name = await getRequiredFlag({ flags, name: 'name' });
		const { config, driver } = await resolveConfigAndDriver({ cwd, command: 'plan' });
		const standards = await readPlanningStandards({ cwd, config });

		if (subcommand === 'draft') {
			await planDraftCommand({ cwd, driver, name, standards, config, flags });
			return;
		}

		if (subcommand === 'dedup') {
			await planDedupCommand({ cwd, driver, name, standards, config });
			return;
		}

		// A `--phase` present but yielding no values reaches the runner as an empty
		// list, which it refuses — the "graded less than you asked and said
		// nothing" failure this work exists to remove.
		const phases = getListFlag({ flags, name: 'phase' });

		await planGradeCommand({ cwd, driver, name, standards, config, phases });
		return;
	}

	console.error(usage);
	return exitCli({ code: 1 });
};
