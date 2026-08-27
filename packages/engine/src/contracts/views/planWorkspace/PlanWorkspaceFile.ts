import { z } from 'zod';

/** One file of a plan workspace, stat'd rather than read — what it is called, where it is, how big it is and when it last changed. */
export const PlanWorkspaceFile = z.object({
	/** Workspace-relative name, e.g. 'implemented/phase1-design-system.md'. */
	name: z.string(),
	/** Repo-relative path, ready for `getPlanDocument`. */
	path: z.string(),
	bytes: z.number(),
	/** ISO mtime. */
	updatedAt: z.string(),
});

export type PlanWorkspaceFile = z.infer<typeof PlanWorkspaceFile>;
