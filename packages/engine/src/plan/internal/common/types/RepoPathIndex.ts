/**
 * The working-tree facts the prose-path check decides against, gathered once
 * per lint run. Deciding "is this name real" by looking it up in an enumerable
 * list rather than by searching the repo's text is the whole point: a renamed
 * file's old name survives in READMEs and captured datasets, so a text search
 * reports it as real.
 */
export interface RepoPathIndex {
	/** Directory names directly under the repo root — what makes a span anchored. */
	topLevelDirs: Set<string>;
	/**
	 * EVERY file under the repo root, repo-relative — the pool a shorthand
	 * fragment's tail is matched against. Every file, not every source file:
	 * the question this pool answers is "does a file with this tail exist",
	 * which has nothing to do with which files a standards check reads.
	 */
	files: string[];
}
