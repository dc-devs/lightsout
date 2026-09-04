import { z } from 'zod';

/**
 * One entry of a plan's `## Prose Files` list: a file the plan describes in
 * words because no test can state its behaviour. Documents, config and some UI
 * have acceptance criteria no test names; forcing a ledger row for them
 * produces invented tests or dropped criteria, so they are exempted explicitly
 * and the exemption carries its reason.
 */
export const ProseFile = z.object({
	/** Repo-relative path, also listed under one of the plan's file headings. */
	path: z.string().min(1),
	/** Why no test states this file's behaviour. */
	reason: z.string().min(1),
	line: z.number().int().positive(),
});

export type ProseFile = z.infer<typeof ProseFile>;
