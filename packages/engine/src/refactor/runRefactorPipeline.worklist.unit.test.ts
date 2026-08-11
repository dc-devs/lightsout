import { execSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from '@jest/globals';
import { linkTypescript } from '@tests/helpers/linkTypescript';
import { report } from '@tests/helpers/report';
import { reviewReport } from '@tests/helpers/reviewReport';
import { roleOf } from '@tests/helpers/roleOf';
import { setupConsumerRepo } from '@tests/helpers/setupConsumerRepo';
import { loadConfig } from '@/common/utils/loadConfig';
import { RefactorWorklist } from '@/contracts';
import type { Driver } from '@/drivers';
import { runRefactorPipeline } from '@/refactor';

/** Two exported consts in one file — a compiler-free structure Finding (multi-export). */
const multiExport = 'export const alphaThing = 1;\nexport const betaThing = 2;\n';

/** An over-cap function body — the size rule's advisory, which needs the AST tier. */
const bigFunction = `export const bigThing = () => {\n${Array.from({ length: 85 }, (_, index) => `\tconst v${index} = ${index};`).join('\n')}\n\treturn v0;\n};\n`;

const commitAll = (dir: string) => execSync('git add -A && git -c user.name=t -c user.email=t@t commit -qm fixture', { cwd: dir });

/** Split the fixture's multi-export file — the shape that burns the finding down. */
const splitMulti = ({ dir, file }: { dir: string; file: string }) => {
	writeFileSync(join(dir, file), 'export const alphaThing = 1;\n');
	writeFileSync(join(dir, file.replace(/[^/]+\.ts$/, 'betaThing.ts')), 'export const betaThing = 2;\n');
};

/**
 * A two-folder repo (alpha/ and beta/), one multi-export finding in each, and
 * a driver that judges every batch fine as-is while recording the prompts it
 * was handed — so which findings reached an agent is observable.
 */
const setupTwoFolderRun = async () => {
	const dir = setupConsumerRepo();

	for (const folder of ['alpha', 'beta']) {
		mkdirSync(join(dir, folder), { recursive: true });
		writeFileSync(join(dir, folder, 'multi.ts'), multiExport);
	}

	commitAll(dir);

	const prompts: string[] = [];
	const driver: Driver = {
		name: 'stub',
		invoke: async ({ prompt }) => {
			if (roleOf(prompt) === 'standards-review') {
				return { text: reviewReport(), exitCode: 0 };
			}

			prompts.push(prompt);

			return { text: report({ friction: [{ area: 'other', kind: 'decision', detail: 'left as-is: exempt by design' }] }), exitCode: 0 };
		},
	};

	return { dir, driver, prompts, config: await loadConfig({ cwd: dir }) };
};

/**
 * One multi-export finding whose cluster is already accepted in the committed
 * baseline ledger — the burn-down's starting position — plus a driver that
 * splits the file and records whether it was ever asked to.
 */
const setupBaselinedRun = async () => {
	const dir = setupConsumerRepo();

	writeFileSync(join(dir, 'src/multi.ts'), multiExport);
	writeFileSync(
		join(dir, 'lightsout.standards-baseline.json'),
		`${JSON.stringify({ at: '2026-01-01T00:00:00.000Z', path: '.', siteKeys: ['multi-export:src/multi.ts'] })}\n`,
	);
	commitAll(dir);

	const prompts: string[] = [];
	const driver: Driver = {
		name: 'stub',
		invoke: async ({ prompt }) => {
			if (roleOf(prompt) === 'standards-review') {
				return { text: reviewReport(), exitCode: 0 };
			}

			prompts.push(prompt);
			splitMulti({ dir, file: 'src/multi.ts' });

			return {
				text: report({
					changedFiles: [
						{ path: 'src/multi.ts', summary: 'split' },
						{ path: 'src/betaThing.ts', summary: 'split' },
					],
				}),
				exitCode: 0,
			};
		},
	};

	return { dir, driver, prompts, config: await loadConfig({ cwd: dir }) };
};

/**
 * Two multi-export findings in ONE folder — two findings of the SAME rule, so
 * the burn-down tally has something to add up rather than merely list. The
 * driver judges the batch fine as-is, leaving both findings standing.
 */
const setupTwoFindingFolder = async () => {
	const dir = setupConsumerRepo();

	writeFileSync(join(dir, 'src/one.ts'), 'export const alphaOne = 1;\nexport const betaOne = 2;\n');
	writeFileSync(join(dir, 'src/two.ts'), 'export const alphaTwo = 1;\nexport const betaTwo = 2;\n');
	commitAll(dir);

	const driver: Driver = {
		name: 'stub',
		invoke: async () => ({ text: report({ friction: [{ area: 'other', kind: 'decision', detail: 'left as-is: exempt by design' }] }), exitCode: 0 }),
	};

	return { dir, driver, config: await loadConfig({ cwd: dir }) };
};

/** A standalone `lightsout standards-check` report already on disk when the run starts. */
const priorReport = `${JSON.stringify({ at: '2026-01-01T00:00:00.000Z', path: '.', findings: [], notes: [] })}\n`;

/**
 * One multi-export finding, optionally a report file left by an earlier
 * standalone check, and a driver that must never be reached — the run parks at
 * the budget ceiling, so what the work-list build did is observable before any
 * batch touches the tree.
 */
const setupParkedRun = async ({ report }: { report?: string } = {}) => {
	const dir = setupConsumerRepo();

	writeFileSync(join(dir, 'src/multi.ts'), multiExport);
	commitAll(dir);

	if (report) {
		mkdirSync(join(dir, '.lightsout'), { recursive: true });
		writeFileSync(join(dir, '.lightsout/standards-check.json'), report);
	}

	const driver: Driver = {
		name: 'stub',
		invoke: async ({ prompt }) => {
			if (roleOf(prompt) === 'standards-review') {
				return { text: reviewReport(), exitCode: 0 };
			}

			throw new Error('the budget ceiling must be reached before any agent is spawned');
		},
	};

	return { dir, driver, config: await loadConfig({ cwd: dir }) };
};

/**
 * Two findings, one per package under the DEFAULT packages dir — the other arm
 * of the grouping the configured-packagesDir test covers.
 */
const setupDefaultPackagesRun = async () => {
	const dir = setupConsumerRepo();

	mkdirSync(join(dir, 'packages/api'), { recursive: true });
	mkdirSync(join(dir, 'packages/web'), { recursive: true });
	writeFileSync(join(dir, 'packages/api/multi.ts'), multiExport);
	writeFileSync(join(dir, 'packages/web/pair.ts'), 'export const gammaThing = 3;\nexport const deltaThing = 4;\n');
	commitAll(dir);

	const driver: Driver = {
		name: 'stub',
		invoke: async ({ prompt }) => {
			if (roleOf(prompt) === 'standards-review') {
				return { text: reviewReport(), exitCode: 0 };
			}

			throw new Error('the budget ceiling must be reached before any agent is spawned');
		},
	};

	return { dir, driver, config: await loadConfig({ cwd: dir }) };
};

/** The frozen work-list the run wrote into its run dir, re-read through its contract. */
const readWorklist = ({ dir, plan }: { dir: string; plan: string }) => RefactorWorklist.parse(JSON.parse(readFileSync(join(dir, plan), 'utf8')));

describe('runRefactorPipeline work-list', () => {
	test('a check scope confines the run to that subtree and is frozen with the work-list', async () => {
		const { dir, driver, prompts, config } = await setupTwoFolderRun();

		const result = await runRefactorPipeline({ cwd: dir, driver, config, path: 'alpha' });

		expect(result.ok).toBe(true);
		// only the in-scope finding counts as work
		expect(result.before).toStrictEqual({ 'multi-export': 1 });
		// the out-of-scope folder never became a batch
		expect(result.declined.map((entry) => entry.batchId)).toStrictEqual(['batch-01:multi-export:alpha']);
		// no agent was pointed outside the scope:\n${prompts.join('\n\n')}
		expect(prompts.every((prompt) => !prompt.includes('beta/multi.ts'))).toBeTruthy();

		const worklist = readWorklist({ dir, plan: result.manifest.plan });

		// the scope is frozen with the work-list, so resume checks the same subtree
		expect(worklist.path).toBe('alpha');
		expect(worklist.batches.map((batch) => batch.id)).toStrictEqual(['batch-01:multi-export:alpha']);
	});

	test('the frozen work-list carries Finding-severity work with every advisory as context', async () => {
		const dir = setupConsumerRepo();

		linkTypescript({ dir });
		writeFileSync(join(dir, 'src/multi.ts'), `export const alphaThing = 1;\n${bigFunction}`);
		commitAll(dir);

		const driver: Driver = {
			name: 'stub',
			invoke: async ({ prompt }) => {
				if (roleOf(prompt) === 'standards-review') {
					return { text: reviewReport(), exitCode: 0 };
				}

				throw new Error('the budget ceiling must be reached before any agent is spawned');
			},
		};
		const result = await runRefactorPipeline({ cwd: dir, driver, config: await loadConfig({ cwd: dir }), maxBatches: 0 });

		expect(result.manifest.status).toBe('paused-budget');

		const worklist = readWorklist({ dir, plan: result.manifest.plan });
		const advisories = worklist.batches.flatMap((batch) => batch.advisories);

		// the over-cap function rode along as context
		expect(advisories.length > 0).toBeTruthy();
		// EVERY advisory rides along, not just the size ones — each carries its own
		// guidance, and one the agent never sees is one it can never judge
		expect([...new Set(advisories.map((advisory) => advisory.rule))].sort()).toStrictEqual(['dead-export', 'explicit-return-type', 'size-function']);
		// advisories are never batched as work
		expect([...new Set(worklist.batches.flatMap((batch) => batch.blocking.map((finding) => finding.severity)))]).toStrictEqual(['blocking']);
	});

	test('a configured packagesDir batches by package rather than by the shared parent folder', async () => {
		const dir = setupConsumerRepo({ config: { packagesDir: 'modules' } });

		mkdirSync(join(dir, 'modules/api'), { recursive: true });
		mkdirSync(join(dir, 'modules/web'), { recursive: true });
		writeFileSync(join(dir, 'modules/api/multi.ts'), multiExport);
		writeFileSync(join(dir, 'modules/web/pair.ts'), 'export const gammaThing = 3;\nexport const deltaThing = 4;\n');
		commitAll(dir);

		const driver: Driver = {
			name: 'stub',
			invoke: async ({ prompt }) => {
				if (roleOf(prompt) === 'standards-review') {
					return { text: reviewReport(), exitCode: 0 };
				}

				throw new Error('the budget ceiling must be reached before any agent is spawned');
			},
		};
		const result = await runRefactorPipeline({ cwd: dir, driver, config: await loadConfig({ cwd: dir }), maxBatches: 0 });

		expect(result.manifest.status).toBe('paused-budget');

		const worklist = readWorklist({ dir, plan: result.manifest.plan });

		// each package is its own batch area — on the default packagesDir both
		// findings would collapse into a single `modules` batch, pointing one agent
		// at two packages
		expect([...new Set(worklist.batches.map((batch) => batch.folder))].filter((folder) => folder.startsWith('modules'))).toStrictEqual([
			'modules/api',
			'modules/web',
		]);
	});

	test('an unconfigured packagesDir still batches per package under packages/', async () => {
		const { dir, driver, config } = await setupDefaultPackagesRun();

		const result = await runRefactorPipeline({ cwd: dir, driver, config, maxBatches: 0 });

		expect(result.manifest.status).toBe('paused-budget');

		const worklist = readWorklist({ dir, plan: result.manifest.plan });

		// 'packages' is the default the work-list supplies — without it both
		// findings would share one `packages` batch, pointing one agent at two
		// packages
		expect([...new Set(worklist.batches.map((batch) => batch.folder))].filter((folder) => folder.startsWith('packages'))).toStrictEqual([
			'packages/api',
			'packages/web',
		]);
	});

	test('a run given no scope and no mode freezes the whole repo, baseline-filtered', async () => {
		const { dir, driver, config } = await setupParkedRun();

		const result = await runRefactorPipeline({ cwd: dir, driver, config, maxBatches: 0 });

		expect(result.manifest.status).toBe('paused-budget');

		const worklist = readWorklist({ dir, plan: result.manifest.plan });

		// '.' is the exact value a resumed run reads back to decide it has no
		// subpath scope, and `all: false` is what keeps accepted debt out of it
		expect(worklist).toEqual(expect.objectContaining({ path: '.', all: false }));
	});

	test('building the work-list leaves an existing standards-check report untouched', async () => {
		const { dir, driver, config } = await setupParkedRun({ report: priorReport });

		const result = await runRefactorPipeline({ cwd: dir, driver, config, maxBatches: 0 });

		expect(result.manifest.status).toBe('paused-budget');
		// the work-list's check persists nothing: a refactor run must not clobber
		// the report the user's own `lightsout standards-check` left behind
		expect(readFileSync(join(dir, '.lightsout/standards-check.json'), 'utf8')).toBe(priorReport);
	});

	test('the burn-down tally adds up every finding of a rule, not one entry per rule', async () => {
		const { dir, driver, config } = await setupTwoFindingFolder();

		const result = await runRefactorPipeline({ cwd: dir, driver, config });

		expect(result.ok).toBe(true);
		// both findings carry the 'multi-export' rule and must accumulate under it
		expect(result.before).toStrictEqual({ 'multi-export': 2 });
		// nothing was resolved, so the closing re-check tallies the same two
		expect(result.after).toStrictEqual({ 'multi-export': 2 });
	});

	test('a baselined finding is not work — the run completes as a verdict, spawning nothing', async () => {
		const { dir, driver, prompts, config } = await setupBaselinedRun();

		const result = await runRefactorPipeline({ cwd: dir, driver, config });

		expect(result.ok).toBe(true);
		expect(result.manifest.status).toBe('passed');
		// accepted debt is not the refactor run’s work
		expect(result.before).toStrictEqual({});
		// no agent was spent on already-accepted debt
		expect(prompts.length).toBe(0);
	});

	test('burn-down mode takes the baselined finding as work and burns it down', async () => {
		const { dir, driver, prompts, config } = await setupBaselinedRun();

		const result = await runRefactorPipeline({ cwd: dir, driver, config, all: true });

		expect(result.ok).toBe(true);
		// the accepted cluster is the work-list in burn-down mode
		expect(result.before['multi-export']).toBe(1);
		// and it burned down
		expect(result.after['multi-export'] ?? 0).toBe(0);
		// the batch reached an agent
		expect(prompts.length > 0).toBeTruthy();

		const worklist = readWorklist({ dir, plan: result.manifest.plan });

		// the mode is frozen with the work-list, so resume re-checks the same way
		expect(worklist.all).toBe(true);
	});

	test('a repo outside any git worktree is refused before any run state exists', async () => {
		const dir = setupConsumerRepo({ git: false });

		writeFileSync(join(dir, 'src/multi.ts'), multiExport);

		const driver: Driver = {
			name: 'stub',
			invoke: async ({ prompt }) => {
				if (roleOf(prompt) === 'standards-review') {
					return { text: reviewReport(), exitCode: 0 };
				}

				throw new Error('no agent may be spawned where the diff cannot be attributed');
			},
		};

		await expect(runRefactorPipeline({ cwd: dir, driver, config: await loadConfig({ cwd: dir }) })).rejects.toThrow(/requires a git worktree/);
	});
});
