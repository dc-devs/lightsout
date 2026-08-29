import { z } from 'zod';

/**
 * The optional `queue` block of `lightsout.config.json` — everything
 * `lightsout queue` needs that is a house convention rather than a universal.
 *
 * Every team-specific word lives here: which tracker, which team, which label
 * routes a ticket to which worker, which statuses count as available work, and
 * which environment variable holds the API key. The engine spells none of them
 * in source; the only tracker vocabulary it knows is what this block names.
 *
 * `.strict()` for the same reason `ConfigShip` is strict: the rest of the
 * config strips unknown keys, and a typo here would silently disable a setting
 * the user believes is active.
 */
export const ConfigQueue = z
	.object({
		/** Which tracker the queue reads. Only Linear has an adapter today. */
		tracker: z.literal('linear'),
		/** The tracker's team key, e.g. 'LO' — every query is scoped to it. */
		team: z.string(),
		/** Which ticket label routes a ticket to which worker. A label named here is the human's opt-in to automation. */
		'route-labels': z.object({ direct: z.string(), 'auto-plan': z.string() }).strict(),
		/** How many tickets may be in flight at once. Also the ceiling on how many questions can ever wait for the user at the same time. */
		'max-parallel': z.number().int().positive(),
		/** Name of the environment variable holding the tracker API key. The key itself is never written to config. */
		'api-key-env': z.string(),
		/** Ticket statuses the queue may pick up. Default `['Backlog', 'Ready to implement']`. */
		'eligible-statuses': z.array(z.string()).optional(),
		/** Status the queue moves a ticket to when it picks it up. Default `'In Progress'`. */
		'in-progress-status': z.string().optional(),
		/** Command run once in a fresh worktree before any agent, e.g. `pnpm install`. Absent means nothing runs. */
		setup: z.string().optional(),
		/**
		 * How a ticket becomes a branch name. `{ticket}` is the lowercased
		 * identifier, `{slug}` the slugged title. Default `{ticket}-{slug}`.
		 * A company convention like `feature/{ticket}-{slug}` goes here — and
		 * whatever it produces must be matched by `ship.ticket-pattern`, which
		 * is equally the repo's to configure.
		 */
		'branch-template': z.string().optional(),
		/**
		 * The ticket-body heading relayed answers are appended under. A
		 * tracker convention, so a config value. Default `## Decisions`.
		 */
		'decisions-heading': z.string().optional(),
		/**
		 * Ceiling for one ticket's auto-plan worker session — the session that
		 * plans a ticket and sits through the implement run it launches. Per
		 * ticket, never for the drain: the queue itself has no ceiling and runs
		 * until the backlog is dry. A hit ceiling parks the ticket resumably,
		 * exactly like every other agent timeout. A duration string like '90s',
		 * '45m' or '4h'. Default `'4h'`.
		 */
		'worker-timeout': z.string().optional(),
		/**
		 * How long one relayed question waits for an answer before its ticket
		 * parks. A duration string like '90s', '45m' or '4h'. Default `'1h'`.
		 * Only `--file-relay` observes it: the terminal relay waits on a person
		 * who is present, and gives up when their terminal goes away.
		 */
		'question-timeout': z.string().optional(),
		/**
		 * The ticket label the queue sets when a ticket parks and clears when it
		 * resumes or ships. Opt-in with no default — a repo that names none never
		 * has one invented for it. The label is created on the team on first use.
		 */
		'parked-label': z.string().optional(),
	})
	.strict();

export type ConfigQueue = z.infer<typeof ConfigQueue>;
