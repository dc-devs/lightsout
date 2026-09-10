import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { commitDirectRun } from '#src/cli/common/implementRun/commitDirectRun.ts';
import { createProgressPrinter } from '#src/cli/common/utils/createProgressPrinter.ts';
import { exitCli } from '#src/cli/common/utils/exitCli.ts';
import { readGitChangedFiles } from '#src/common/git/readGitChangedFiles.ts';
import { type LightsoutConfig, type RunManifest, RunStatus, WorktreeOwner } from '#src/contracts/index.ts';
import { runDirectWork } from '#src/direct/index.ts';
import type { Driver } from '#src/drivers/index.ts';
import type { PipelineResult } from '#src/pipeline/index.ts';
import { getRunDir } from '#src/runState/index.ts';
import { readWorktreeRecord } from '#src/worktree/index.ts';

/**
 * The ticket body the first invocation froze beside the run, read from the
 * checkout the run's records live in.
 *
 * That file is the input a resume must not re-derive: the ticket on disk may
 * have been edited or deleted since, and the run was built from this copy.
 */
const readFrozenTicket = ({ cwd, manifest }: { cwd: string; manifest: RunManifest }) => readFile(resolve(cwd, manifest.plan), 'utf8').catch(() => undefined);

/**
 * Why the workspace may not be committed in, or undefined when it may.
 *
 * The commit stages through `git add -A`, so in a checkout the user chose
 * themselves — what `--no-worktree` leaves a run standing in — anything they
 * edited after the run parked would ride into the ticket's pull request. The
 * dirty tree is therefore compared against what the run itself recorded: its own
 * changed files plus the files that were already dirty when it started.
 *
 * Refusing every dirty tree instead would make an opted-out direct run
 * unresumable, because a parked run's own partial work is exactly what makes
 * that tree dirty. A workspace lightsout created skips the comparison outright:
 * it was cut for this run and holds nothing else.
 */
const describeUnownedEdits = async ({ workspace, manifest }: { workspace: string; manifest: RunManifest }) => {
	const record = manifest.branch === undefined ? undefined : await readWorktreeRecord({ cwd: workspace, branch: manifest.branch });

	if (record?.owner === WorktreeOwner.Implement) {
		return undefined;
	}

	const own = new Set([...manifest.changedFiles, ...manifest.baselineDirtyFiles]);
	const stray = ((await readGitChangedFiles({ cwd: workspace })) ?? []).filter((path) => !own.has(path));

	return stray.length === 0
		? undefined
		: `${workspace} holds changes this run did not make: ${stray.join(', ')} — commit or stash them before resuming, or they ride into this ticket's commit`;
};

/**
 * Commit a resumed direct run's work, when there is work left uncommitted.
 *
 * A clean workspace means the commit already landed and only the ship failed,
 * which is not the worker having changed nothing — so it is skipped rather than
 * refused.
 *
 * @returns undefined when there is nothing standing in the way of the ship tail, or the one sentence that is
 */
const commitResumedWork = async ({
	cwd,
	workspace,
	manifest,
	ticketBody,
	ticketRef,
	generated,
}: {
	cwd: string;
	workspace: string;
	manifest: RunManifest;
	ticketBody: string;
	ticketRef: string;
	generated: string[] | undefined;
}) => {
	const dirty = (await readGitChangedFiles({ cwd: workspace })) ?? [];

	if (dirty.length === 0) {
		return undefined;
	}

	const unowned = await describeUnownedEdits({ workspace, manifest });

	return (
		unowned ??
		(await commitDirectRun({
			cwd: workspace,
			ticketBody,
			ticketRef,
			// The run directory comes from the checkout the records live in: the two
			// are no longer the same directory once a run builds in a worktree.
			runDir: getRunDir({ cwd, runId: manifest.runId }),
			generated,
			onProgress: createProgressPrinter(),
		}))
	);
};

interface Params {
	/** The checkout the command was launched from — where the run's records and its frozen ticket live. */
	cwd: string;
	/** The checkout the work happens in, as the run's manifest recorded it. */
	workspace: string;
	/** The run being continued, restamped with this invocation's ship intent. */
	manifest: RunManifest;
	config: LightsoutConfig;
	driver: Driver;
	/** The config's `generated` path prefixes, forwarded to the commit step. */
	generated: string[] | undefined;
	/** Whether a passing run will ship, so a continued build records the same row a first one would. */
	willShip: boolean;
}

/**
 * Continue a parked direct run in the workspace it recorded: its unfinished
 * stage, then the commit it never made.
 *
 * The run id, the frozen ticket and the partial changes already in the tree are
 * all kept — a commit or a ship that failed is not a reason to build the ticket
 * again — so a run that already passed skips the worker entirely and goes
 * straight to the commit.
 */
export const continueDirectRun = async ({ cwd, workspace, manifest, config, driver, generated, willShip }: Params): Promise<PipelineResult> => {
	const ticketBody = await readFrozenTicket({ cwd, manifest });

	if (ticketBody === undefined) {
		console.error(`ticket file not found: ${manifest.plan}`);
		return exitCli({ code: 1 });
	}

	const ticketRef = manifest.ticketRef ?? manifest.branch ?? 'ticket';
	const built =
		manifest.status === RunStatus.Passed
			? { ok: true, manifest }
			: await runDirectWork({
					cwd: workspace,
					ticketBody,
					ticketRef,
					driver,
					driverName: manifest.harness,
					config,
					existing: manifest,
					willShip,
					onProgress: createProgressPrinter(),
				});

	const uncommitted = built.ok ? await commitResumedWork({ cwd, workspace, manifest, ticketBody, ticketRef, generated }) : undefined;

	if (uncommitted !== undefined) {
		console.error(uncommitted);
		return exitCli({ code: 1 });
	}

	return built;
};
