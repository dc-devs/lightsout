import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createProgressPrinter } from '#src/cli/common/utils/createProgressPrinter.ts';
import { exitCli } from '#src/cli/common/utils/exitCli.ts';
import type { LightsoutConfig, RunManifest } from '#src/contracts/index.ts';
import { runDirectWork } from '#src/direct/index.ts';
import type { Driver } from '#src/drivers/index.ts';
import type { PipelineResult } from '#src/pipeline/index.ts';

/**
 * The ticket body the first invocation froze beside the run, read from the
 * checkout the run's records live in.
 *
 * That file is the input a resume must not re-derive: the ticket on disk may
 * have been edited or deleted since, and the run was built from this copy.
 */
const readFrozenTicket = ({ cwd, manifest }: { cwd: string; manifest: RunManifest }) => readFile(resolve(cwd, manifest.plan), 'utf8').catch(() => undefined);

interface Params {
	/** The checkout the command was launched from — where the run's records and its frozen ticket live. */
	cwd: string;
	/** The checkout the work happens in, as the run's manifest recorded it. */
	workspace: string;
	/** The run being continued, restamped with this invocation's ship intent. */
	manifest: RunManifest;
	config: LightsoutConfig;
	driver: Driver;
	/** Whether a passing run will ship, so a continued build records the same row a first one would. */
	willShip: boolean;
}

/**
 * Continue a parked direct run in the workspace it recorded: its unfinished
 * stage, and then the commit it never made.
 *
 * The run id, the frozen ticket and the partial changes already in the tree are
 * all kept — a commit or a ship that failed is not a reason to build the ticket
 * again. Every status is handed back to the same pipeline, which decides for
 * itself from the run's own `verify` step record whether anything is left to
 * build: a run whose gates are already green goes straight to its commit, and
 * that commit is the run's rather than this edge's, so a resumed run and a
 * first run cannot end differently.
 */
export const continueDirectRun = async ({ cwd, workspace, manifest, config, driver, willShip }: Params): Promise<PipelineResult> => {
	const ticketBody = await readFrozenTicket({ cwd, manifest });

	if (ticketBody === undefined) {
		console.error(`ticket file not found: ${manifest.plan}`);
		return exitCli({ code: 1 });
	}

	return runDirectWork({
		cwd: workspace,
		ticketBody,
		ticketRef: manifest.ticketRef ?? manifest.branch ?? 'ticket',
		driver,
		driverName: manifest.harness,
		config,
		existing: manifest,
		willShip,
		onProgress: createProgressPrinter(),
	});
};
