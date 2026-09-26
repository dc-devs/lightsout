import type { RunListing } from '#src/contracts/views/RunListing.ts';

interface Params {
	run: RunListing;
}

/** The run family a listing belongs to: its coordinator when it records one, itself otherwise. */
export const getRunFamilyRoot = ({ run }: Params): string => run.parentRunId ?? run.runId;
