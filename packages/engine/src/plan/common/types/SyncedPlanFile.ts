/** What writing one engine-owned section into one plan file did to it — the per-file outcome every section sync returns, printed one line each by the CLI. */
export interface SyncedPlanFile {
	/** Absolute path of the plan file. */
	path: string;
	/** True when the section differed and the file was rewritten. */
	updated: boolean;
}
