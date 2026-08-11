import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

interface Params {
	dir: string;
}

/** Read the "<label> <kind>" lines the gateLogCommand gates appended. */
export const readGateLog = ({ dir }: Params) => (existsSync(join(dir, 'gates.log')) ? readFileSync(join(dir, 'gates.log'), 'utf8').trim().split('\n') : []);
