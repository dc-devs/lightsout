import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { CoverageWorklist, PipelineKind, RefactorWorklist, type RunManifest } from '#src/contracts/index.ts';
import { getRunDir } from '#src/runState/index.ts';
import type { FrozenWorklist } from '#src/views/common/types/FrozenWorklist.ts';

interface Params {
	cwd: string;
	manifest: RunManifest;
}

/**
 * A run's frozen work-list, tagged by the pipeline that froze it. The kind is
 * decided before the file is opened, so a work-list that will not parse still
 * says which pipeline wrote it.
 *
 * Its own file rather than a helper inside `readRunListing`, because the run
 * detail reads it once and hands the result to two consumers — the listing row
 * and the burn-down — instead of opening `worklist.json` twice.
 */
export const readFrozenWorklist = async ({ cwd, manifest }: Params): Promise<FrozenWorklist> => {
	const raw = await readFile(join(getRunDir({ cwd, runId: manifest.runId }), 'worklist.json'), 'utf8').catch(() => undefined);
	let parsed: unknown;

	try {
		parsed = raw === undefined ? undefined : JSON.parse(raw);
	} catch {
		parsed = undefined;
	}

	let frozen: FrozenWorklist;

	if (manifest.pipeline === PipelineKind.Coverage) {
		frozen = { kind: PipelineKind.Coverage, worklist: CoverageWorklist.safeParse(parsed).data };
	} else {
		frozen = { kind: PipelineKind.Refactor, worklist: RefactorWorklist.safeParse(parsed).data };
	}

	return frozen;
};
