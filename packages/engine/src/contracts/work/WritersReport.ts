import { z } from 'zod';
import { WorkReport } from '#src/contracts/work/WorkReport.ts';

/**
 * The step-record `report` payload the write-tests step persists: one entry per
 * writer batch it ran.
 *
 * The envelope is declared rather than left implicit so a reader can recognise
 * a writers step the same way it recognises every other step — by parsing the
 * opaque `report` against a contract — instead of guessing from the step's id.
 */
export const WritersReport = z.object({
	reports: z.array(WorkReport),
});

export type WritersReport = z.infer<typeof WritersReport>;
