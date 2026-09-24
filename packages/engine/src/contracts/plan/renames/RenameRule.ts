import { z } from 'zod';

/**
 * One entry of a plan's `## Renames` section. A plan or phase file carrying at
 * least one is rename-only: it is built without test writing, and every change
 * it makes is held to its renames in code rather than read by an agent.
 */
export const RenameRule = z.object({
	/** The literal, case-sensitive text every occurrence of which is replaced. */
	from: z.string().min(1),
	/** The literal text it becomes. */
	to: z.string().min(1),
	/** 1-based line the bullet sits at in the plan file. */
	line: z.number().int().positive(),
});

export type RenameRule = z.infer<typeof RenameRule>;
