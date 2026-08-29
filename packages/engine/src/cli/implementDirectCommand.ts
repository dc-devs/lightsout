import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { getRequiredFlag } from '#src/cli/common/args/getRequiredFlag.ts';
import { getStringFlag } from '#src/cli/common/args/getStringFlag.ts';
import { printResult } from '#src/cli/common/render/printResult.ts';
import type { CommandContext } from '#src/cli/common/types/CommandContext.ts';
import { createProgressPrinter } from '#src/cli/common/utils/createProgressPrinter.ts';
import { exitAfterImplement } from '#src/cli/common/utils/exitAfterImplement.ts';
import { exitCli } from '#src/cli/common/utils/exitCli.ts';
import { resolveEffectiveConfigAndDriver } from '#src/cli/common/utils/resolveEffectiveConfigAndDriver.ts';
import { readConfig } from '#src/common/config/readConfig.ts';
import { readGitChangedFiles } from '#src/common/git/readGitChangedFiles.ts';
import { readGitCurrentBranch } from '#src/common/git/readGitCurrentBranch.ts';
import type { LightsoutConfig } from '#src/contracts/index.ts';
import { runDirectWork } from '#src/direct/index.ts';
import { commitTicketWork } from '#src/queue/index.ts';
import { getRunDir } from '#src/runState/index.ts';
import { readTicketMatch, resolveShipSettings } from '#src/ship/index.ts';

/**
 * The ticket reference when `--ref` was not typed: the branch's own, falling
 * back to the branch name. It only labels the run and the commit, so a branch
 * the pattern cannot read is named rather than refused.
 */
const readBranchTicketRef = async ({ cwd, config }: { cwd: string; config: LightsoutConfig }) => {
	const shipSettings = resolveShipSettings({ config });
	const branch = await readGitCurrentBranch({ cwd });

	if (branch === undefined) {
		return 'ticket';
	}

	return (shipSettings === undefined ? undefined : readTicketMatch({ branch, ticketPattern: shipSettings.ticketPattern })?.ticket) ?? branch;
};

/**
 * `lightsout implement-direct` — build one ticket straight from its body, with
 * the repo's own gates as the only bar, and commit what passes.
 *
 * A dirty tree is refused, and only here: the run ends in `git add -A`, which
 * on a dirty tree would sweep the user's unrelated files into the ticket's
 * commit. The queue's worktrees are always born clean, so only this standalone
 * path can hit it.
 *
 * There is deliberately no current-branch check, mirroring `lightsout
 * implement`: the command runs on whatever branch the checkout holds, and a
 * default-branch mistake is refused downstream by ship.
 */
export const implementDirectCommand = async ({ flags, cwd }: CommandContext): Promise<void> => {
	const ticketPath = await getRequiredFlag({ flags, name: 'ticket' });
	const ticketBody = await readFile(resolve(cwd, ticketPath), 'utf8').catch(() => undefined);

	if (ticketBody === undefined) {
		console.error(`ticket file not found: ${ticketPath}`);
		return exitCli({ code: 1 });
	}

	const dirty = await readGitChangedFiles({ cwd });

	if (dirty === undefined) {
		console.error(`git could not read the tree at ${cwd} — implement-direct commits what it builds, so it needs a readable git worktree`);
		return exitCli({ code: 1 });
	}

	if (dirty.length > 0) {
		console.error('implement-direct commits everything in the tree; commit or stash your changes first');
		return exitCli({ code: 1 });
	}

	const loaded = await readConfig({ cwd });
	const ticketRef = getStringFlag({ flags, name: 'ref' }) ?? (await readBranchTicketRef({ cwd, config: loaded }));
	const { config, driver, driverName } = resolveEffectiveConfigAndDriver({ config: loaded, command: 'implement' });

	console.log(`lightsout: building ${ticketRef} from ${ticketPath}`);

	const result = await runDirectWork({ cwd, ticketBody, ticketRef, driver, driverName, config, onProgress: createProgressPrinter() });

	if (result.ok) {
		// The run ends on a commit rather than a dirty tree — which is what makes
		// `--ship` and `ship.after-implement` work at all.
		const subject = ticketBody
			.split('\n')[0]
			.replace(/^#+\s*/, '')
			.trim();
		const committed = await commitTicketWork({
			cwd,
			message: `${ticketRef} ${subject}`.trim(),
			runDir: getRunDir({ cwd, runId: result.manifest.runId }),
		});

		if ('error' in committed) {
			console.error(committed.error);
			return exitCli({ code: 1 });
		}

		if (!committed.committed) {
			// A run that produced no commit must never chain into ship.
			console.error('the worker changed nothing');
			return exitCli({ code: 1 });
		}
	}

	await printResult({ result, cwd });
	return exitAfterImplement({ config: loaded, cwd, result, shipFlag: flags.get('ship') === true, noShipFlag: flags.get('no-ship') === true, env: process.env });
};
