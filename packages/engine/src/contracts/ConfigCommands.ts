import { z } from 'zod';
import { Effort } from '#src/contracts/Effort.ts';

/** One command's harness override: harness, model, and/or effort, each falling back to the global field. */
const commandHarness = z
	.object({
		/** Harness name for this command ('claude-code', 'codex', 'omp' or 'pi'). Falls back to the global `harness`. */
		harness: z.string().optional(),
		/** Model for this command's harness. The global `model` falls through only when this command resolves to the global harness. */
		model: z.string().optional(),
		/** Reasoning effort for this command. Falls back to the global `effort` regardless of which harness the command selects — the five levels mean the same thing everywhere. */
		effort: z.enum(Effort).optional(),
	})
	.strict();

/**
 * Per-command harness selection (`plan` covers draft/dedup/grade; `resume`
 * always keeps the run manifest's recorded harness). Each entry overrides the
 * global `harness`/`model`/`effort` for that command; unlisted commands use
 * the globals. Both objects are `.strict()` — unlike the rest of the config,
 * a typoed key here would silently disable an override the user believes
 * is active, so it fails parsing loudly instead.
 */
export const ConfigCommands = z
	.object({
		implement: commandHarness.optional(),
		refactor: commandHarness.optional(),
		improve: commandHarness.optional(),
		plan: commandHarness.optional(),
		'test-coverage-to-threshold': commandHarness.optional(),
	})
	.strict();

export type ConfigCommands = z.infer<typeof ConfigCommands>;
