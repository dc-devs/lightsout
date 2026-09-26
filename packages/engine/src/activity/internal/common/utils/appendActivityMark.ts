import { appendFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { ActivityMark } from '#src/contracts/activity/ActivityMark.ts';

interface Params {
	path: string;
	mark: ActivityMark;
}

/**
 * Append one mark to an activity record as a single JSON line, creating the
 * record's directory first.
 *
 * A failed write is swallowed rather than raised: evidence must never fail the
 * work it describes, and a record nobody could write is a missing report rather
 * than a broken run.
 *
 * It deliberately does not reuse `appendJsonlRecords`, which stamps a run id and
 * a step onto every record — an implementation run's provenance, which this
 * record has neither of.
 */
export const appendActivityMark = async ({ path, mark }: Params): Promise<void> => {
	await mkdir(dirname(path), { recursive: true })
		.then(() => appendFile(path, `${JSON.stringify(mark)}\n`, 'utf8'))
		.catch(() => undefined);
};
