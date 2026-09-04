import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { getRequiredFlag } from '#src/cli/common/args/getRequiredFlag.ts';
import { getStringFlag } from '#src/cli/common/args/getStringFlag.ts';
import { printResult } from '#src/cli/common/render/printResult.ts';
import type { CommandContext } from '#src/cli/common/types/CommandContext.ts';
import { createProgressPrinter } from '#src/cli/common/utils/createProgressPrinter.ts';
import { exitAfterImplement } from '#src/cli/common/utils/exitAfterImplement.ts';
import { exitCli } from '#src/cli/common/utils/exitCli.ts';
import { resolveCommandShipIntent } from '#src/cli/common/utils/resolveCommandShipIntent.ts';
import { resolveEffectiveConfigAndDriver } from '#src/cli/common/utils/resolveEffectiveConfigAndDriver.ts';
import { readConfig } from '#src/common/config/readConfig.ts';
import { readGitChangedFiles } from '#src/common/git/readGitChangedFiles.ts';
import { readGitCurrentBranch } from '#src/common/git/readGitCurrentBranch.ts';
import type { LightsoutConfig } from '#src/contracts/index.ts';
import { runDirectWork } from '#src/direct/index.ts';
import { commitTicketWork } from '#src/queue/index.ts';
import { getRunDir } from '#src/runState/index.ts';
import { readBranchTicketRef } from '#src/ship/index.ts';
import { requireImplementLifecycle } from '#src/ticketLifecycle/index.ts';

/**
 * The label the run and its commit carry when `--ref` was not typed: the
 * branch's ticket reference, falling back to the branch name and then to a
 * placeholder. It only labels, so a branch the pattern cannot read is named
 * rather than refused.
 */
const readRunLabel = async ({ cwd, config }: { cwd: string; config: LightsoutConfig }) =>
	(await readBranchTicketRef({ config, cwd })) ?? (await readGitCurrentBranch({ cwd })) ?? 'ticket';

/**
 * The commit a passed run ends on — which is what makes `--ship` and
 * `ship.after-implement` work at all — or the sentence saying why there is none.
 *
 * A run that produced no commit must never chain into ship, so "the worker
 * changed nothing" is a refusal here rather than a quiet success.
 *
 * @returns undefined when the work is committed, or the one sentence saying why it is not
 */
const commitDirectRun = async ({
	cwd,
	ticketBody,
	ticketRef,
	runId,
	generated,
	onProgress,
}: {
	cwd: string;
	ticketBody: string;
	ticketRef: string;
	runId: string;
	generated: string[] | undefined;
	onProgress: (message: string) => void;
}) => {
	const subject = ticketBody
		.split('\n')[0]
		.replace(/^#+\s*/, '')
		.trim();
	const committed = await commitTicketWork({
		cwd,
		message: `${ticketRef} ${subject}`.trim(),
		runDir: getRunDir({ cwd, runId }),
		generated,
		onProgress,
	});

	if ('error' in committed) {
		return committed.error;
	}

	return committed.committed ? undefined : 'the worker changed nothing';
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
	const shipIntent = resolveCommandShipIntent({ config: loaded, flags, env: process.env });

	if (shipIntent === undefined) {
		return exitCli({ code: 1 });
	}

	const flaggedRef = getStringFlag({ flags, name: 'ref' });
	const ticketRef = flaggedRef ?? (await readRunLabel({ cwd, config: loaded }));
	const { config, driver, driverName } = resolveEffectiveConfigAndDriver({ config: loaded, command: 'implement' });
	// The guard is handed `--ref` itself rather than `ticketRef`, whose
	// branch-name fallback is a run label rather than a ticket reference. Without
	// the flag it reads the branch through `readBranchTicketRef`, the same reader
	// the label above starts from.
	const refused = await requireImplementLifecycle({ cwd, config: loaded, env: process.env, ticketRef: flaggedRef, onProgress: createProgressPrinter() });

	if (refused !== undefined) {
		console.error(refused);
		return exitCli({ code: 1 });
	}

	console.log(`lightsout: building ${ticketRef} from ${ticketPath}`);

	const result = await runDirectWork({
		cwd,
		ticketBody,
		ticketRef,
		driver,
		driverName,
		config,
		willShip: shipIntent.willShip,
		onProgress: createProgressPrinter(),
	});

	if (result.ok) {
		const uncommitted = await commitDirectRun({
			cwd,
			ticketBody,
			ticketRef,
			runId: result.manifest.runId,
			generated: loaded.generated,
			onProgress: createProgressPrinter(),
		});

		if (uncommitted !== undefined) {
			console.error(uncommitted);
			return exitCli({ code: 1 });
		}
	}

	await printResult({ result, cwd });
	return exitAfterImplement({ config: loaded, cwd, result, shipFlag: flags.get('ship') === true, noShipFlag: flags.get('no-ship') === true, env: process.env });
};
