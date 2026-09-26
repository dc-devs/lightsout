/**
 * One folder's share of the open findings, and which rules put them there.
 *
 * A presentation of the findings rather than a fact about them: the folder is
 * cut to a depth the reader chose, so the same findings regroup as that dial
 * moves.
 */
export interface FolderGroup {
	/** Repo-relative folder, cut to a readable depth — 'packages/engine/src/plan'. */
	folder: string;
	count: number;
	/** Rule ids contributing to this folder, most findings first. */
	rules: { rule: string; count: number }[];
}
