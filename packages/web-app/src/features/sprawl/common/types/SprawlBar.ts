/** One file drawn as a bar, positioned in the caller's own unit box. */
export interface SprawlBar {
	/** Repo-relative path — the React key, so a bar keeps its identity as it grows and shrinks. */
	path: string;
	x: number;
	y: number;
	width: number;
	height: number;
	/** Over the cap for this file's dialect — `.tsx` files are held to the wider one. */
	overCap: boolean;
}
