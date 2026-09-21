import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { readGitChangedFiles } from '#src/common/git/readGitChangedFiles.ts';
import { type LightsoutConfig, PipelineKind, type RunManifest } from '#src/contracts/index.ts';
import { createRun, getRunDir } from '#src/runState/index.ts';

interface Params {
	cwd: string;
	runId: string;
	ticketBody: string;
	ticketRef: string;
	driverName: string;
	config: LightsoutConfig;
	willShip?: boolean;
}

/** The run this ticket is built in, with the ticket body written beside it as the document the run was built from. */
export const createDirectRun = async ({ cwd, runId, ticketBody, ticketRef, driverName, config, willShip }: Params): Promise<RunManifest> => {
	const ticketPath = join(getRunDir({ cwd, runId }), 'ticket.md');
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
