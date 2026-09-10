import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { getRequiredFlag } from '#src/cli/common/args/getRequiredFlag.ts';
import { getStringFlag } from '#src/cli/common/args/getStringFlag.ts';
import { commitDirectRun } from '#src/cli/common/implementRun/commitDirectRun.ts';
import { finishImplementRun } from '#src/cli/common/implementRun/finishImplementRun.ts';
import { openDirectWorkspace } from '#src/cli/common/implementRun/openDirectWorkspace.ts';
import type { CommandContext } from '#src/cli/common/types/CommandContext.ts';
import type { RunWorkspace } from '#src/cli/common/types/RunWorkspace.ts';
import { createProgressPrinter } from '#src/cli/common/utils/createProgressPrinter.ts';
import { exitCli } from '#src/cli/common/utils/exitCli.ts';
import { resolveCommandShipIntent } from '#src/cli/common/utils/resolveCommandShipIntent.ts';
import { resolveEffectiveConfigAndDriver } from '#src/cli/common/utils/resolveEffectiveConfigAndDriver.ts';
import { readConfig } from '#src/common/config/readConfig.ts';
import { readGitCurrentBranch } from '#src/common/git/readGitCurrentBranch.ts';
import type { LightsoutConfig } from '#src/contracts/index.ts';
import { runDirectWork } from '#src/direct/index.ts';
import type { Driver } from '#src/drivers/index.ts';
import { getRunDir } from '#src/runState/index.ts';
import { readBranchTicketRef } from '#src/ship/index.ts';
import { requireImplementLifecycle } from '#src/ticketLifecycle/index.ts';

/**
 * The label the run and its commit carry when `--ref` was not typed: the
 * branch's ticket reference, falling back to the branch name and then to a
 * placeholder. It only labels, so a branch the pattern cannot read is named
 * rather than refused.
 *
 * It reads the WORKSPACE, so an isolated run is labelled from the branch it was
 * just put on rather than from whatever the user happened to be standing on.
 */
const readRunLabel = async ({ cwd, config }: { cwd: string; config: LightsoutConfig }) =>
	(await readBranchTicketRef({ config, cwd })) ?? (await readGitCurrentBranch({ cwd })) ?? 'ticket';

/**
 * The run, and the commit a passed one ends on.
 *
 * A run that did not pass is never committed — a failed build leaves the tree
 * for a human — so `uncommitted` stays undefined for it and the caller's exit
 * code comes from the result instead.
 */
const buildAndCommit = async ({
	cwd,
	ticketBody,
	ticketRef,
	driver,
	driverName,
	config,
	generated,
	willShip,
}: {
	cwd: string;
	ticketBody: string;
	ticketRef: string;
	driver: Driver;
	driverName: string;
	config: LightsoutConfig;
	generated: string[] | undefined;
	willShip: boolean;
}) => {
	const result = await runDirectWork({ cwd, ticketBody, ticketRef, driver, driverName, config, willShip, onProgress: createProgressPrinter() });
	// The run directory travels as a path rather than an id: the checkout the work
	// is in and the checkout the run's records live in are no longer the same
	// directory, so only the caller can say where the message file belongs.
	const runDir = getRunDir({ cwd, runId: result.manifest.runId });
	const uncommitted = result.ok ? await commitDirectRun({ cwd, ticketBody, ticketRef, runDir, generated, onProgress: createProgressPrinter() }) : undefined;

	return { result, uncommitted };
};

/** The startup line: which checkout the run builds in, on which branch, from which ticket file. */
const printDirectRunHeader = ({ workspace, ticketRef, ticketPath }: { workspace: RunWorkspace; ticketRef: string; ticketPath: string }) => {
	const where = workspace.isolated ? `${workspace.cwd} on ${workspace.branch}` : `${workspace.cwd} — the checkout this was launched from`;

	console.log(`lightsout: building ${ticketRef} from ${ticketPath} in ${where}`);
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
 * implement`: the run builds on whatever branch its workspace holds, and a
 * default-branch mistake is refused downstream by ship.
 */
export const implementDirectCommand = async ({ flags, cwd }: CommandContext): Promise<void> => {
	const namedTicketPath = await getRequiredFlag({ flags, name: 'ticket' });
	// Read from the launching checkout, before anything is created, so a missing
	// file is refused without a worktree being made for it.
	const ticketBody = await readFile(resolve(cwd, namedTicketPath), 'utf8').catch(() => undefined);

	if (ticketBody === undefined) {
		console.error(`ticket file not found: ${namedTicketPath}`);
		return exitCli({ code: 1 });
	}

	const loaded = await readConfig({ cwd });
	const shipIntent = resolveCommandShipIntent({ config: loaded, flags, env: process.env });

	if (shipIntent === undefined) {
		return exitCli({ code: 1 });
	}

	const flaggedRef = getStringFlag({ flags, name: 'ref' });
	const opened = await openDirectWorkspace({ cwd, config: loaded, flags, ticketPath: namedTicketPath, ticketBody, flaggedRef });

	if ('error' in opened) {
		console.error(opened.error);
		return exitCli({ code: 1 });
	}

	const { workspace, ticketPath } = opened;
	const ticketRef = flaggedRef ?? (await readRunLabel({ cwd: workspace.cwd, config: loaded }));
	const { config, driver, driverName } = resolveEffectiveConfigAndDriver({ config: loaded, command: 'implement' });
	// The guard is handed `--ref` itself rather than `ticketRef`, whose
	// branch-name fallback is a run label rather than a ticket reference. Without
	// the flag it reads the branch through `readBranchTicketRef`, the same reader
	// the label above starts from.
	const refused = await requireImplementLifecycle({
		cwd: workspace.cwd,
		config: loaded,
		env: process.env,
		ticketRef: flaggedRef,
		onProgress: createProgressPrinter(),
	});

	if (refused !== undefined) {
		console.error(refused);
		return exitCli({ code: 1 });
	}

	printDirectRunHeader({ workspace, ticketRef, ticketPath });

	const { result, uncommitted } = await buildAndCommit({
		cwd: workspace.cwd,
		ticketBody,
		ticketRef,
		driver,
		driverName,
		config,
		generated: loaded.generated,
		willShip: shipIntent.willShip,
	});

	if (uncommitted !== undefined) {
		console.error(uncommitted);
		return exitCli({ code: 1 });
	}

	return finishImplementRun({ config: loaded, cwd: workspace.cwd, result, flags });
};
