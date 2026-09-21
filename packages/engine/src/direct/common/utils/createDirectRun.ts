import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { readGitChangedFiles } from '#src/common/git/readGitChangedFiles.ts';
import { readGitCurrentBranch } from '#src/common/git/readGitCurrentBranch.ts';
import { type LightsoutConfig, PipelineKind, type RunManifest } from '#src/contracts/index.ts';
import { createRun, resolveNewRunDir } from '#src/runState/index.ts';

interface Params {
	cwd: string;
	runId: string;
	/** The ticket body, verbatim — written beside the run as the document it was built from. */
	ticketBody: string;
	/** The ticket's human reference, for the run header. */
	ticketRef: string;
	/** Recorded on the manifest as the harness name. */
	driverName: string;
	config: LightsoutConfig;
	/** Resolved before the run starts: a passing run will ship this branch. */
	willShip?: boolean;
}

/** The run this ticket is built in, with the ticket body written beside it as the document the run was built from. */
export const createDirectRun = async ({ cwd, runId, ticketBody, ticketRef, driverName, config, willShip }: Params): Promise<RunManifest> => {
	// The directory has to be known before the run is created: the manifest's
	// `plan` field points at a `ticket.md` inside it. A direct run belongs to no
	// plan, so it is filed under the ticket branch it is built on — and under
	// `direct/runs/` only when there is no branch to file it under.
	const ticketBranch = await readGitCurrentBranch({ cwd });
	const ticketPath = join(await resolveNewRunDir({ cwd, ticketBranch, pipeline: PipelineKind.Direct, runId }), 'ticket.md');
	const manifest = await createRun({
		cwd,
		runId,
		plan: ticketPath,
		pipeline: PipelineKind.Direct,
		ticketRef,
		driver: driverName,
		config,
		baselineDirtyFiles: await readGitChangedFiles({ cwd }),
		willShip,
	});

	// There is no plan file for direct work; the ticket body is the document the
	// run was built from, so it is what the manifest records.
	await writeFile(ticketPath, ticketBody.endsWith('\n') ? ticketBody : `${ticketBody}\n`, 'utf8');

	return manifest;
};
