import { z } from 'zod';
import { ShipMergeMethod } from '#src/contracts/ship/ShipMergeMethod.ts';

/**
 * The optional `ship` block of `lightsout.config.json` — everything
 * `lightsout ship` needs that is a house convention rather than a universal.
 *
 * The engine learns "ticket reference" here and nothing else: which tracker a
 * team runs, what its magic words are, and what a pull request body should say
 * are all this block's business, so no tracker vocabulary ever reaches engine
 * source.
 *
 * `.strict()` for the same reason `ConfigCommands` is strict: the rest of the
 * config strips unknown keys, and a typo here would silently disable a setting
 * the user believes is active.
 */
export const ConfigShip = z
	.object({
		/**
		 * A JavaScript regular expression source matched against the branch name.
		 * It must carry a named group `ticket`; that group's value becomes the
		 * result's `ticketRef`. Every other named group becomes a token the
		 * `pr-body` template may use. Default `^(?<ticket>[a-z]+-\d+)`.
		 */
		'ticket-pattern': z.string().optional(),
		/**
		 * The pull request body template. Brace-wrapped tokens are substituted:
		 * `branch`, and one per named group of the ticket pattern. An unknown
		 * token is left exactly as written. The default is the bare ticket token
		 * on its own, which is deliberately inert — a body that closes something
		 * automatically is a tracker's convention, not the engine's.
		 */
		'pr-body': z.string().optional(),
		/** How the forge merges. Default `merge`. */
		'merge-method': z.enum(ShipMergeMethod).optional(),
		/** When true, a passed `lightsout implement` run chains into ship without `--ship` being typed. Default false. */
		'after-implement': z.boolean().optional(),
	})
	.strict();

export type ConfigShip = z.infer<typeof ConfigShip>;
