import { z } from 'zod';

/**
 * The optional `auto-plan` block of `lightsout.config.json` — which of
 * `/auto-plan`'s checkpoints a repo keeps and which it removes.
 *
 * Every key is off by default, so an absent block is the most supervised
 * behaviour there is: the skill plans the whole ticket, shows one proposal of
 * the finished plan, and stops. Turning a key on is a repo saying the factory
 * may carry on that far without asking.
 *
 * No engine code reads this block — the skill does, straight off the file. It
 * is declared here anyway because every key a config may write is validated,
 * described and shown by the config view; a key only a skill knew about would
 * be invisible to `doctor` and to the config page, and a typo in it would
 * silently disable a setting the user believes is on.
 *
 * `.strict()` for the same reason `ConfigShip` is strict: the rest of the
 * config strips unknown keys, and the typo above has to fail loudly.
 */
export const ConfigAutoPlan = z
	.object({
		/**
		 * When true the proposal comes before `plan draft` spends an agent, and
		 * carries the design shape rather than the finished plan. Default false:
		 * the proposal shows the real, graded plan.
		 */
		'propose-before-draft': z.boolean().optional(),
		/**
		 * When true an approved proposal starts `lightsout implement` rather than
		 * stopping at the handoff line. Default false — auto-plan only plans.
		 */
		'implement-on-approval': z.boolean().optional(),
		/**
		 * When true the proposal is skipped entirely, provided nothing cleared the
		 * escalation bar; a question that clears it parks the run instead of being
		 * guessed past. Default false.
		 */
		'auto-approve': z.boolean().optional(),
	})
	.strict();

export type ConfigAutoPlan = z.infer<typeof ConfigAutoPlan>;
