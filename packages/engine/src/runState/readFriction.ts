import { FrictionRecord } from '@/contracts';
import { getFrictionPath } from '@/runState/common/paths/getFrictionPath';
import { readJsonlRecords } from '@/runState/common/utils/readJsonlRecords';

interface Params {
	cwd: string;
}

/**
 * Read the accumulated friction log. Validated line-by-line at the boundary;
 * malformed lines are skipped, never guessed at.
 */
export const readFriction = async ({ cwd }: Params): Promise<FrictionRecord[]> => readJsonlRecords({ path: getFrictionPath({ cwd }), schema: FrictionRecord });
