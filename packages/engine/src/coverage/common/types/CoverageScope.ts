/** One scope's coverage command, and where that scope writes its summary. */
export interface CoverageScope {
	scope: string;
	command: string;
	/** Repo-relative path to this scope's summary report. */
	summaryPath: string;
}
