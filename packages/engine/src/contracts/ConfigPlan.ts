import { z } from 'zod';
import { WorkOrderMode } from '#src/contracts/workOrder/WorkOrderMode.ts';

/**
 * The optional `plan` block of `lightsout.config.json` — whether this
 * repository's plans are written as contracts with an acceptance-test ledger,
 * the counts above which one plan file is heavy enough to earn the reader
 * fan-out, and whether a planning session works in its own worktree.
 *
 * Every switch but `worktree` is off by default, so an absent block writes and
 * grades plans exactly as every plan command did before those keys existed: the
 * same template, the same required sections, the reader fleet on every plan
 * file. `worktree` defaults on, as `implement.worktree` does, and
 * `default-work-order-mode` defaults to `single-plan`, which is how a work
 * order's folder behaved before it could hold several plans. Turning
 * `contract` on is a repository saying its plans carry the tests that state
 * their acceptance criteria, so grading may be mostly mechanical.
 *
 * `.strict()` for the same reason `ConfigShip` is strict: the rest of the config
 * strips unknown keys, and a typo in an opt-in switch has to fail loudly rather
 * than silently leave the feature off.
 */
export const ConfigPlan = z
	.object({
		/** When true the writer produces the contract shape with an acceptance-test ledger, the lint requires the ledger section, and the grade weighs each plan file and spawns readers only for heavy ones. Default false: every plan command behaves exactly as before this key existed. */
		contract: z.boolean().optional(),
		/** The mode a work order's own record is created with: `single-plan`, where plan 001 alone supplies the work order's implementation, or `multiple-plan`, where the work order's plans implement in numeric order on one branch. Default `single-plan`. Read only when a record is created, so changing it never rewrites a work order that already has one. */
		'default-work-order-mode': z.enum(WorkOrderMode).optional(),
		/** Whether a planning session works in its own isolated git worktree rather than the checkout it was launched from. Default true. `--worktree` and `--no-worktree` override it for one command. */
		worktree: z.boolean().optional(),
		/** The counts above which a plan file is heavy. Each key optional; see `defaultWeightThresholds`. */
		'weight-thresholds': z
			.object({
				/** A file creating more source files than this is heavy. Default 3. */
				'created-files': z.number().int().min(0).optional(),
				/** A file touching more packages than this is heavy. Default 1. */
				packages: z.number().int().min(1).optional(),
			})
			.strict()
			.optional(),
	})
	.strict();

export type ConfigPlan = z.infer<typeof ConfigPlan>;
