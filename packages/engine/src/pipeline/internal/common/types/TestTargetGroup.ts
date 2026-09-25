/** One writer's assignment: public surfaces to test through, and the changed files those tests must execute. */
export interface TestTargetGroup {
	/** Repo-relative public subject files — the only files a test file may target. May include unchanged files. */
	subjects: string[];
	/** Repo-relative changed files that must execute under the group's tests. */
	mustExecute: string[];
}
