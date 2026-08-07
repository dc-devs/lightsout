import { join } from 'node:path';
import { FrictionRecord } from '@/contracts';
import { readJsonlRecords } from '@/runState/common/utils/readJsonlRecords';

interface Params {
	cwd: string;
}

/**
 * Read the accumulated friction log. Validated line-by-line at the boundary;
 * malformed lines are skipped, never guessed at.
 */
export const readFriction = async ({ cwd }: Params) => readJsonlRecords({ path: join(cwd, '.lightsout', 'friction.jsonl'), schema: FrictionRecord });
