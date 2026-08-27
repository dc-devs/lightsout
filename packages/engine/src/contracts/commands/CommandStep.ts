import { z } from 'zod';
import { CommandActor } from '#src/contracts/commands/CommandActor.ts';

/** One card of a command's infographic, and one heading of its manual page's "what happens" section. */
export const CommandStep = z.object({
	/** Caps, as the infographic renders it: 'START THE RUN'. */
	title: z.string(),
	actor: z.enum(CommandActor),
	/** 2–4 complete thoughts. Backticks render mono in the infographic. */
	bullets: z.array(z.string()),
	/** Italic line: what this step prevents. */
	note: z.string().optional(),
	/** Files the step writes — paths only, no commentary. */
	saved: z.array(z.string()).default([]),
	/** Overrides the graphic-wide 'SAVED TO DISK' label for one step. */
	savedLabel: z.string().optional(),
});

export type CommandStep = z.infer<typeof CommandStep>;
