import { readJsonlRecords } from '#src/common/utils/readJsonlRecords.ts';
import { FrictionRecord } from '#src/contracts/index.ts';
import { getFrictionPath } from '#src/runState/common/paths/getFrictionPath.ts';

interface Params {
	cwd: string;
}

/**
 * Read the accumulated friction log. Validated line-by-line at the boundary;
 * malformed lines are skipped, never guessed at.
 */
export const readFriction = async ({ cwd }: Params): Promise<FrictionRecord[]> => readJsonlRecords({ path: getFrictionPath({ cwd }), schema: FrictionRecord });
