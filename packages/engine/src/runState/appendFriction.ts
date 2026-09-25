import { appendJsonlRecords } from '#src/common/utils/appendJsonlRecords.ts';
import type { FrictionEntry } from '#src/contracts/friction/FrictionEntry.ts';
import { FrictionRecord } from '#src/contracts/friction/FrictionRecord.ts';
import { getFrictionPath } from '#src/runState/common/paths/getFrictionPath.ts';

interface Params {
	/** The checkout the run works in — a linked worktree during an isolated run; the primary is resolved from it. */
	cwd: string;
	runId: string;
	step: string;
	friction: FrictionEntry[];
}

/**
 * Persist friction entries to `.lightsout/friction.jsonl` in the target repo's
 * primary checkout. Append-only: friction accumulates across runs — that's what
 * lets the improvement loop see systemic patterns instead of one-offs, and one
 * ledger per repository is what keeps an isolated run's entries in it.
 */
export const appendFriction = async ({ cwd, runId, step, friction }: Params): Promise<void> =>
	appendJsonlRecords({ path: await getFrictionPath({ cwd }), schema: FrictionRecord, entries: friction, runId, step });
