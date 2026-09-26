import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { getStringFlag } from '#src/cli/common/args/getStringFlag.ts';
import type { CommandContext } from '#src/cli/common/types/CommandContext.ts';
import { exitCli } from '#src/cli/common/utils/exitCli.ts';
import { getRequiredFlag } from '#src/cli/internal/common/args/getRequiredFlag.ts';
import { finishImplementRun } from '#src/cli/internal/common/implementRun/finishImplementRun.ts';
import { openDirectWorkspace } from '#src/cli/internal/common/implementRun/openDirectWorkspace.ts';
import { readBodyBuildPlanName } from '#src/cli/internal/common/implementRun/readBodyBuildPlanName.ts';
import { printConfigSource } from '#src/cli/internal/common/render/printConfigSource.ts';
import type { RunWorkspace } from '#src/cli/internal/common/types/RunWorkspace.ts';
import { createProgressPrinter } from '#src/cli/internal/common/utils/createProgressPrinter.ts';
import { resolveCommandShipIntent } from '#src/cli/internal/common/utils/resolveCommandShipIntent.ts';
import { resolveEffectiveConfigAndDriver } from '#src/cli/internal/common/utils/resolveEffectiveConfigAndDriver.ts';
import { readConfig } from '#src/common/config/readConfig.ts';
import { resolveConfigPath } from '#src/common/config/resolveConfigPath.ts';
import { readGitCurrentBranch } from '#src/common/git/readGitCurrentBranch.ts';
import { readRunLabel } from '#src/common/utils/readRunLabel.ts';
import type { LightsoutConfig } from '#src/contracts/LightsoutConfig.ts';
import { runDirectWork } from '#src/direct/runDirectWork.ts';
import type { Driver } from '#src/drivers/common/types/Driver.ts';
import { requireImplementLifecycle } from '#src/ticketLifecycle/requireImplementLifecycle.ts';
import { runWorkOrderPlanLifecycle } from '#src/workOrder/implementRun/runWorkOrderPlanLifecycle.ts';

/**
 * The run itself, and whatever the ticket record owes about it.
 *
 * The commit the run ends on is the run's own: one commit per unit of work that
 * passed its own gates, made inside the pipeline before the run is stamped
 * passed. This edge makes none of its own and exits on the run's result.
 */
const runDirectBuild = async ({
	cwd,
	planName,
	ticketBody,
	ticketRef,
	driver,
	driverName,
	config,
	willShip,
}: {
	cwd: string;
	/** The ticket plan this build implements, when the record says one claims it. */
	planName: string | undefined;
	ticketBody: string;
	ticketRef: string;
	driver: Driver;
	driverName: string;
	config: LightsoutConfig;
	willShip: boolean;
}) => {
	const build = (runId?: string) =>
		runDirectWork({ cwd, ticketBody, ticketRef, runId, driver, driverName, config, willShip, onProgress: createProgressPrinter() });
	// A build no plan claims is the build this command has always run: no
	// pre-minted id, and nothing written to any record.
	const outcome =
		planName === undefined ? { result: await build() } : await runWorkOrderPlanLifecycle({ cwd, name: planName, run: ({ runId }) => build(runId) });

	if ('refusal' in outcome) {
		return { refusal: outcome.refusal };
	}

	const { result } = outcome;
	const recordError = 'recordError' in outcome ? outcome.recordError : undefined;

	return { result, recordError };
};

/**
 * Everything the opened workspace settles before a model is spent: the label the
 * run and its commit carry, the harness they run under, the pre-source lifecycle
 * write the branch's ticket owes, and the plan (if any) the ticket record says
 * this body build is the implementation of.
 *
 * They all read the WORKSPACE, because the branch the build happens on is the
 * one they all answer for, and each refusal leaves before anything is built.
 *
 * @returns the run's label, harness and claimed plan, or the one sentence refusing the run
 */
const prepareDirectRun = async ({
	workspace,
	loaded,
	flaggedRef,
}: {
	workspace: RunWorkspace;
	loaded: LightsoutConfig;
	/** `--ref` as typed, or undefined. */
	flaggedRef: string | undefined;
}) => {
	const ticketRef = flaggedRef ?? (await readRunLabel({ cwd: workspace.cwd }));
	const { config, driver, driverName } = resolveEffectiveConfigAndDriver({ config: loaded, command: 'implement' });
	// The guard is handed `--ref` itself rather than `ticketRef`, whose
	// branch-name fallback is a run label rather than a ticket reference. Without
	// the flag it reads the branch's work order through `readWorkOrderTicketRef`,
	// the same reader the label above starts from.
	const refused = await requireImplementLifecycle({
		cwd: workspace.cwd,
		config: loaded,
		env: process.env,
		ticketRef: flaggedRef,
		onProgress: createProgressPrinter(),
	});

	if (refused !== undefined) {
		return { error: refused };
	}

	const planName = await readBodyBuildPlanName({ cwd: workspace.cwd, branch: workspace.branch ?? (await readGitCurrentBranch({ cwd: workspace.cwd })) });

	return typeof planName === 'object' ? planName : { ticketRef, config, driver, driverName, planName };
};

/** The startup lines: which checkout the run builds in, on which branch, from which ticket file — and which config file it read. */
const printDirectRunHeader = ({
	workspace,
	ticketRef,
	ticketPath,
	configPath,
}: {
	workspace: RunWorkspace;
	ticketRef: string;
	ticketPath: string;
	configPath: string;
}) => {
	const where = workspace.isolated ? `${workspace.cwd} on ${workspace.branch}` : `${workspace.cwd} — the checkout this was launched from`;

	console.log(`lightsout: building ${ticketRef} from ${ticketPath} in ${where}`);
	printConfigSource({ configPath });
};

/**
 * `lightsout implement-direct` — build one ticket straight from its body, with
 * the repo's own gates as the only bar, and commit what passes.
 *
 * The commit is the run's, not this edge's: the pipeline makes it before the
 * run is stamped passed, so a run that produced none is already a failure by
 * the time the result arrives here.
 *
 * A dirty tree is refused in the workspace the run builds in, because the run
 * ends in `git add -A` and would otherwise sweep the user's unrelated files
 * into the ticket's commit. The queue's worktrees are always born clean, so
 * only a checkout a person chose themselves can hit it.
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
	const opened = await openDirectWorkspace({ cwd, config: loaded, flags, ticketPath: namedTicketPath, flaggedRef });

	if ('error' in opened) {
		console.error(opened.error);
		return exitCli({ code: 1 });
	}

	const { workspace, ticketPath } = opened;
	const prepared = await prepareDirectRun({ workspace, loaded, flaggedRef });

	if ('error' in prepared) {
		console.error(prepared.error);
		return exitCli({ code: 1 });
	}

	const { ticketRef, config, driver, driverName, planName } = prepared;

	printDirectRunHeader({ workspace, ticketRef, ticketPath, configPath: resolveConfigPath({ cwd }) });

	const built = await runDirectBuild({
		cwd: workspace.cwd,
		planName,
		ticketBody,
		ticketRef,
		driver,
		driverName,
		config,
		willShip: shipIntent.willShip,
	});

	if ('refusal' in built) {
		console.error(built.refusal);
		return exitCli({ code: 1 });
	}

	const { result, recordError } = built;

	if (recordError !== undefined) {
		console.error(recordError);
	}

	return finishImplementRun({ config: loaded, cwd: workspace.cwd, result, flags });
};
