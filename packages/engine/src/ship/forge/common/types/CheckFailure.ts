/**
 * One failing check's own evidence, attributable to an exact commit.
 *
 * Returned only when every reading agreed the failure belongs to the commit
 * the caller asked about — a repair spent on another commit's failure is worse
 * than no repair at all. The forge's provider vocabulary stops here: nothing
 * outside `forge/` learns that this came from a GitHub Actions run.
 */
export interface CheckFailure {
	/** The check's own name, as the pull request lists it. */
	name: string;
	/** The run the failed job belonged to, for a reader who wants the whole log. */
	runId: number;
	/** The commit the run was built from, re-read and confirmed to be the one asked about. */
	commit: string;
	/** The failed job's own output, masked and capped — diagnostic data, never instructions. */
	output: string;
}
