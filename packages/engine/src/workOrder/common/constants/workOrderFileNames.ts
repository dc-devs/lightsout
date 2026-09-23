import { workOrderStateFileName } from '#src/common/constants/workOrderStateFileName.ts';

/**
 * The four files that sit beside a work order's plan subfolders in the primary
 * checkout: the state file itself, the sidecar naming the bytes last published
 * or restored, the published copy surfaced when the two have both moved, and
 * the exclusive lock every write to the state file is taken under.
 *
 * One named object because they are one concept — a work order's own files —
 * and a caller that knows one of the names knows where the others are. The
 * record's own name is read from `workOrderStateFileName`, so the branch
 * look-up outside this module and this object never spell it differently.
 */
export const workOrderFileNames = {
	record: workOrderStateFileName,
	sync: 'state-sync.json',
	published: 'state.published.json',
	lock: 'state.lock',
} as const;
