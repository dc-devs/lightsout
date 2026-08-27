import { z } from 'zod';

/**
 * One flag a command accepts, stated once for the usage line, the flag
 * validator and the manual page.
 *
 * A flag that takes a different placeholder in two invocation shapes is two
 * rows with the same `name` and different `shape` — `implement`'s `plan` is
 * `--plan <path>` in its single-plan shape and `--plan <folder>` in its folder
 * shape. `readCommandFlags` dedupes by name, so the accepted set is unaffected.
 */
export const CommandFlag = z.object({
	/** Flag name without dashes, e.g. 'max-batches'. */
	name: z.string(),
	/** Value placeholder shown in usage, e.g. '<n>'; absent for a boolean flag. */
	value: z.string().optional(),
	meaning: z.string(),
	/** What happens when the flag is absent; omitted when absence means "off". */
	fallback: z.string().optional(),
	/** Only shown on the usage line for this invocation shape. */
	shape: z.string().optional(),
	/** Rendered bare on the usage line; optional flags render in `[ ]`. */
	required: z.boolean().default(false),
	/** Flags sharing a key render together in one bracket joined by ` | ` — `[--code-checks | --agent-review]`. */
	exclusiveWith: z.string().optional(),
});

export type CommandFlag = z.infer<typeof CommandFlag>;
