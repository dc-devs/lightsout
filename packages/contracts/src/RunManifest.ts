import { z } from 'zod';

/**
 * The on-disk state of a run (`.lightsout/runs/<id>/manifest.json`).
 *
 * State lives here, not in any model's context window — this is what makes
 * runs crash-safe, rate-limit-safe, and resumable at the failed step.
 *
 * Pre-alpha shape: step/budget details harden as the engine lands.
 */
export const RunManifest = z.object({
	runId: z.string(),
	plan: z.string(),
	status: z.string(),
	steps: z.array(
		z.object({
			id: z.string(),
			status: z.string(),
			attempts: z.number(),
		}),
	),
});

export type RunManifest = z.infer<typeof RunManifest>;
