import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { CoverageWorklist, PipelineKind, RefactorWorklist, type RunListing, type RunLock, type RunManifest } from '#src/contracts/index.ts';
import { getRunDir } from '#src/runState/index.ts';
import type { FrozenWorklist } from '#src/views/common/types/FrozenWorklist.ts';
import { buildRunListing } from '#src/views/common/utils/buildRunListing.ts';

/**
 * A run's frozen work-list, tagged by the pipeline that froze it. The kind is
 * decided before the file is opened, so a work-list that will not parse still
 * says which pipeline wrote it.
 */
const readFrozenWorklist = async ({ cwd, manifest }: { cwd: string; manifest: RunManifest }): Promise<FrozenWorklist> => {
	const raw = await readFile(join(getRunDir({ cwd, runId: manifest.runId }), 'worklist.json'), 'utf8').catch(() => undefined);
	let parsed: unknown;

	try {
		parsed = raw === undefined ? undefined : JSON.parse(raw);
	} catch {
		parsed = undefined;
	}

	if (manifest.pipeline === PipelineKind.Coverage) {
		return { kind: PipelineKind.Coverage, worklist: CoverageWorklist.safeParse(parsed).data };
	}

	return { kind: PipelineKind.Refactor, worklist: RefactorWorklist.safeParse(parsed).data };
};

interface Params {
	cwd: string;
	manifest: RunManifest;
	lock: RunLock | undefined;
}

/**
 * One run's list row, work-list and all.
 *
 * Shared by the runs list and the run detail page so the sidebar row and the
 * detail header can never disagree about a run's title, whether it is live, or
 * whether resuming it would do anything.
 */
export const readRunListing = async ({ cwd, manifest, lock }: Params): Promise<RunListing> => {
	const worklist = manifest.plan.endsWith('worklist.json') ? await readFrozenWorklist({ cwd, manifest }) : undefined;

	return buildRunListing({ manifest, lock, worklist });
};
