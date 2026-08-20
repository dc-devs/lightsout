import { getStringFlag } from '#src/cli/common/args/getStringFlag.ts';
import type { CommandContext } from '#src/cli/common/types/CommandContext.ts';
import { exitCli } from '#src/cli/common/utils/exitCli.ts';
import { resolveCommandHarness } from '#src/cli/common/utils/resolveCommandHarness.ts';
import { loadConfig } from '#src/common/utils/loadConfig.ts';
import { messageOf } from '#src/common/utils/messageOf.ts';
import type { LightsoutConfig, RunManifest } from '#src/contracts/index.ts';
import { type Driver, getDriver } from '#src/drivers/index.ts';
import { RunLockError, readRunManifest } from '#src/runState/index.ts';

/** Everything the shared prelude resolved, handed to the pipeline the command actually runs. */
interface BatchedRunStart {
	/** The EFFECTIVE config — harness/model/effort already overwritten with this command's resolved values. */
	config: LightsoutConfig;
	driver: Driver;
	maxBatches: number | undefined;
	/** The manifest of the run being resumed, or undefined for a fresh run. */
	existing: RunManifest | undefined;
}

interface Params<Result extends { ok: boolean }> {
	flags: CommandContext['flags'];
	cwd: string;
	/** Which lightsout command this is — selects its harness entry, and names it in the banner. */
	command: keyof NonNullable<LightsoutConfig['commands']>;
	run: (start: BatchedRunStart) => Promise<Result>;
	print: (params: { result: Result }) => void;
}

/**
 * The shell the batched, resumable pipeline commands share: resolve the config
 * and harness, validate `--max-batches`, load the run `--run` names, announce
 * the run, then hand off to the pipeline and report what came back.
 *
 * These runs MUTATE the repo, so a missing config — meaning no gates — is a
 * hard error here, never the optional-config fallback `plan` and `improve`
 * get. Every failure on the way in prints one line and exits 1: an unknown
 * run id says which id, a lock collision speaks in the lock's own words, and
 * neither is worth a stack trace.
 */
export const runBatchedCommand = async <Result extends { ok: boolean }>({ flags, cwd, command, run, print }: Params<Result>): Promise<void> => {
	const resumeRunId = getStringFlag({ flags, name: 'run' });
	const maxBatchesFlag = getStringFlag({ flags, name: 'max-batches' });
	const loaded = await loadConfig({ cwd });
	const { driverName, model, effort } = resolveCommandHarness({ config: loaded, command });
	const driver = getDriver({ name: driverName });
	const config = { ...loaded, harness: driverName, model, effort };
	const maxBatches = maxBatchesFlag === undefined ? undefined : Number.parseInt(maxBatchesFlag, 10);

	if (maxBatches !== undefined && (!Number.isFinite(maxBatches) || maxBatches < 1)) {
		console.error(`--max-batches must be a positive integer, got '${maxBatchesFlag}'`);
		return exitCli({ code: 1 });
	}

	let existing: RunManifest | undefined;

	try {
		existing = resumeRunId ? await readRunManifest({ cwd, runId: resumeRunId }) : undefined;
	} catch (error) {
		// An unknown id says which id; a manifest that will not parse says that
		// instead, rather than being reported as a run that does not exist.
		console.error(messageOf({ error }));
		return exitCli({ code: 1 });
	}

	console.log(`lightsout: ${command} ${existing ? `resuming run ${existing.runId}` : 'starting run'}`);

	let result: Result;

	try {
		result = await run({ config, driver, maxBatches, existing });
	} catch (error) {
		console.error(`\n${error instanceof RunLockError ? error.message : messageOf({ error })}`);
		return exitCli({ code: 1 });
	}

	print({ result });

	return exitCli({ code: result.ok ? 0 : 1 });
};
