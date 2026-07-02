import { z } from 'zod';

/**
 * Consumer configuration (`lightsout.config.json` at the target repo root).
 * This is the only coupling point between the engine and a consumer — the
 * engine never knows a consumer by name.
 */
export const LightsoutConfig = z.object({
	/** Driver name. Defaults to 'claude-code'. */
	driver: z.string().optional(),
	/** Model override passed through to the harness. */
	model: z.string().optional(),
	/** Harness permission mode for agent invocations. Defaults to 'acceptEdits'. */
	permissionMode: z.string().optional(),
	/** Verification commands — the mechanical gates. Full shell commands. */
	scripts: z.object({
		check: z.string(),
		testUnit: z.string(),
	}),
});

export type LightsoutConfig = z.infer<typeof LightsoutConfig>;
