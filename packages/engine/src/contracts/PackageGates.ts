import { z } from 'zod';

/**
 * Monorepo mode: gate command templates run per affected package, with
 * `{package}` replaced by that package's package.json `name`. When set,
 * verifies run scoped to the run's package scope (plan front-matter
 * `packages:` list or `--packages`, expanded as changed files reveal the
 * true blast radius) and `gates.*` becomes the root-group commands, run
 * only when files outside the packages directory change.
 */
export const PackageGates = z
	.object({
		check: z.string(),
		test: z.string(),
		/** Removed — renamed to `test`. Declared only so a stale key fails loudly instead of being silently stripped. */
		testUnit: z.never('`testUnit` was renamed to `test`').optional(),
		/** Scoped coverage gate. Omitted = no coverage gate for package groups. */
		testCoverage: z.string().optional(),
		/** Opt-in scoped build gate. */
		build: z.string().optional(),
	})
	.refine((templates) => Object.values(templates).every((command) => command === undefined || command.includes('{package}')), {
		message:
			'every packageGates command must contain the {package} placeholder — a command without it would run identically for every package and belongs in gates.* instead',
	});

export type PackageGates = z.infer<typeof PackageGates>;
