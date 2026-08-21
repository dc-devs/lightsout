import { appendJsonlRecords } from '#src/common/utils/appendJsonlRecords.ts';
import { type FrictionEntry, FrictionRecord } from '#src/contracts/index.ts';
import { getFrictionPath } from '#src/runState/common/paths/getFrictionPath.ts';

interface Params {
	cwd: string;
	runId: string;
	step: string;
	friction: FrictionEntry[];
}

/**
 * Persist friction entries to `.lightsout/friction.jsonl` in the target repo.
 * Append-only: friction accumulates across runs — that's what lets the
 * improvement loop see systemic patterns instead of one-offs.
 */
export const appendFriction = ({ cwd, runId, step, friction }: Params): Promise<void> =>
	appendJsonlRecords({ path: getFrictionPath({ cwd }), schema: FrictionRecord, entries: friction, runId, step });
