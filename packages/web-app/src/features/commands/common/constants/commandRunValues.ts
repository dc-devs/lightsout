import { RunCommand } from '#src/features/runs/index.ts';

/**
 * Catalog id → the `RunCommand` values whose runs belong to it. An empty list
 * means the command records no runs of its own.
 *
 * The two vocabularies are genuinely different — `test-coverage-to-threshold`
 * is never the run value `coverage`, and `implement · phased` is never the
 * catalog id `implement` — so the translation is written down rather than
 * assumed. A phased coordinator is an `/implement` run, and `foldPhaseChildren`
 * already folds its children under it.
 *
 * `resume` maps to nothing on purpose: its work is recorded under the command
 * it resumed, and its history section says so instead of showing a table.
 *
 * The card's count and the command's own table both reach this map through
 * `getCommandRuns`, so the two can never print different numbers.
 */
export const commandRunValues: Record<string, RunCommand[]> = {
	brainstorm: [],
	plan: [],
	implement: [RunCommand.Implement, RunCommand.ImplementPhased],
	resume: [],
	refactor: [RunCommand.Refactor],
	'test-coverage-to-threshold': [RunCommand.Coverage],
	'standards-check': [],
	'standards-validate': [],
	'standards-health': [],
	status: [],
	doctor: [],
	friction: [],
	improve: [],
	voice: [],
};
