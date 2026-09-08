/** What one plan file's Decision Log sync did to it — the runner's per-file outcome, printed one line each by the CLI. */
export interface SyncedPlanFile {
	/** Absolute path of the plan file. */
	path: string;
	/** True when the section differed and the file was rewritten. */
	updated: boolean;
}
