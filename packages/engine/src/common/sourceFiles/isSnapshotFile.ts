/** A jest snapshot, whose bytes ARE the assertion the test makes. */
const snapshotFileName = /\.snap$/;

interface Params {
	/** A repo-relative path. */
	path: string;
}

/**
 * Whether a path is a jest snapshot.
 *
 * One spelling, because two questions turn on it: the test-side predicate
 * counts a snapshot as a file the review must see, and the post-gate approval
 * counts it as a file the runner may have written itself. A second snapshot
 * format would otherwise have to be remembered in both places.
 */
export const isSnapshotFile = ({ path }: Params): boolean => {
	return snapshotFileName.test(path);
};
