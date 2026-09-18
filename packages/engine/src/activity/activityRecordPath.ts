import { join } from 'node:path';
import { activityRecordFileName } from '#src/activity/common/constants/activityRecordFileName.ts';

interface Params {
	/** The directory the record lives in. Asking for the path creates nothing. */
	dir: string;
}

/** The activity record file inside the given directory. */
export const activityRecordPath = ({ dir }: Params): string => join(dir, activityRecordFileName);
