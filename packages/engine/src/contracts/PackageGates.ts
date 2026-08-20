import { z } from 'zod';
import { baseGateShape } from '#src/contracts/common/constants/baseGateShape.ts';
import { validateCustomTestGates } from '#src/contracts/common/utils/validateCustomTestGates.ts';

/** The fixed scoped-gate keys — everything else in the block must be a custom `test-*` suite. */
const knownGateKeys = new Set(['check', 'test', 'test-coverage', 'testCoverage', 'testUnit', 'build']);

/**
 * Monorepo mode: gate command templates run per affected package, with
 * `{package}` replaced by that package's package.json `name`. When set,
 * verifies run scoped to the run's package scope (plan front-matter
 * `packages:` list or `--packages`, expanded as changed files reveal the
 * true blast radius) and `gates.*` becomes the root-group commands, run
 * only when files outside the packages directory change.
 *
 * `test` and `test-coverage` are the same suite, plain or instrumented; any
 * other `test-*` key is a custom suite run in written order. Validation only —
 * the parsed value keeps the config's own spelling, so a run manifest's
 * config snapshot round-trips through this schema unchanged.
 */
export const PackageGates = z
	.object({
		...baseGateShape,
		/** Scoped coverage gate. Omitted = no coverage gate for package groups. */
		'test-coverage': z.string().optional(),
		/** Opt-in scoped build gate. */
		build: z.string().optional(),
	})
	.catchall(z.unknown())
	.superRefine((gates, ctx) => {
		const customCommands = validateCustomTestGates({
			gates,
			knownGateKeys,
			ctx,
			unknownKeyMessage: ({ key }) => `unknown scoped gate '${key}' — package-gates are check, test, test-coverage, build, or a custom \`test-*\` suite`,
		});

		const commands = [gates.check, gates.test, gates['test-coverage'], gates.build, ...customCommands];

		if (!commands.every((command) => command === undefined || (typeof command === 'string' && command.includes('{package}')))) {
			ctx.addIssue({
				code: 'custom',
				message:
					'every package-gates command must contain the {package} placeholder — a command without it would run identically for every package and belongs in gates.* instead',
			});
		}
	});

export type PackageGates = z.infer<typeof PackageGates>;
