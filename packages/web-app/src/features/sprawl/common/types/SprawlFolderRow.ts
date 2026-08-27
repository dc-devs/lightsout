/** One folder drawn as a run of squares, one square per direct non-test file. */
export interface SprawlFolderRow {
	/** Repo-relative folder path — the React key. */
	path: string;
	y: number;
	entries: number;
	/** More direct files than the folder-census cap allows. */
	overCap: boolean;
	squares: { x: number; y: number; size: number }[];
}
