import { readJsonlRecords } from '#src/common/utils/readJsonlRecords.ts';
import { ProgressRecord } from '#src/contracts/index.ts';
import { getProgressLogPath } from '#src/runState/progress/getProgressLogPath.ts';

interface Params {
	cwd: string;
	runId: string;
}

/**
 * The last line this run narrated, or undefined when it has narrated nothing
 * a reader can quote — a run started before the log existed, a run whose log
 * holds only malformed lines, or a run that has not spoken yet.
 */
export const readLastProgressMessage = async ({ cwd, runId }: Params): Promise<string | undefined> => {
	const records = await readJsonlRecords({ path: getProgressLogPath({ cwd, runId }), schema: ProgressRecord });

	return records.at(-1)?.message;
};
