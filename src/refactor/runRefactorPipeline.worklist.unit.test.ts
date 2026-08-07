import { execSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, describe, test } from '@jest/globals';
import { RefactorWorklist } from '@/contracts';
import type { Driver } from '@/drivers';
import { loadConfig } from '@/common/utils/loadConfig';
import { runRefactorPipeline } from '@/refactor';
import { linkTypescript } from '@tests/helpers/linkTypescript';
import { report } from '@tests/helpers/report';
import { setupConsumerRepo } from '@tests/helpers/setupConsumerRepo';

/** Two exported consts in one file — a compiler-free structure Finding (multi-export). */
const multiExport = 'export const alphaThing = 1;\nexport const betaThing = 2;\n';

/** An over-cap function body — the size detector's advisory, which needs the AST tier. */
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
		join(dir, 'lightsout.scan-baseline.json'),
		`${JSON.stringify({ at: '2026-01-01T00:00:00.000Z', path: '.', clusters: ['multi-export:src/multi.ts'] })}\n`,
	);
	commitAll(dir);

	const prompts: string[] = [];
	const driver: Driver = {
		name: 'stub',
		invoke: async ({ prompt }) => {
			prompts.push(prompt);
			splitMulti({ dir, file: 'src/multi.ts' });

			return { text: report({ changedFiles: [{ path: 'src/multi.ts', summary: 'split' }, { path: 'src/betaThing.ts', summary: 'split' }] }), exitCode: 0 };
		},
	};

	return { dir, driver, prompts, config: await loadConfig({ cwd: dir }) };
};

/** The frozen work-list the run wrote into its run dir, re-read through its contract. */
const readWorklist = ({ dir, plan }: { dir: string; plan: string }) => RefactorWorklist.parse(JSON.parse(readFileSync(join(dir, plan), 'utf8')));

describe('runRefactorPipeline work-list', () => {
	test('a scan scope confines the run to that subtree and is frozen with the work-list', async () => {
		const { dir, driver, prompts, config } = await setupTwoFolderRun();

		const result = await runRefactorPipeline({ cwd: dir, driver, config, path: 'alpha' });

		expect(result.ok).toBe(true);
		// only the in-scope finding counts as work
		expect(result.before).toStrictEqual({ structure: 1 });
		// the out-of-scope folder never became a batch
		expect(result.declined.map((entry) => entry.batchId)).toStrictEqual(['batch-01:structure:alpha']);
		// no agent was pointed outside the scope:\n${prompts.join('\n\n')}
		expect(prompts.every((prompt) => !prompt.includes('beta/multi.ts'))).toBeTruthy();

		const worklist = readWorklist({ dir, plan: result.manifest.plan });

		// the scope is frozen with the work-list, so resume scans the same subtree
		expect(worklist.path).toBe('alpha');
		expect(worklist.batches.map((batch) => batch.id)).toStrictEqual(['batch-01:structure:alpha']);
	});

	test('the frozen work-list carries Finding-severity work with size advisories as context, nothing else', async () => {
		const dir = setupConsumerRepo();

		linkTypescript({ dir });
		writeFileSync(join(dir, 'src/multi.ts'), `export const alphaThing = 1;\n${bigFunction}`);
		commitAll(dir);

		const driver: Driver = {
			name: 'stub',
			invoke: async () => {
				throw new Error('the budget ceiling must be reached before any agent is spawned');
			},
		};
		const result = await runRefactorPipeline({ cwd: dir, driver, config: await loadConfig({ cwd: dir }), maxBatches: 0 });

		expect(result.manifest.status).toBe('paused-budget');

		const worklist = readWorklist({ dir, plan: result.manifest.plan });
		const advisories = worklist.batches.flatMap((batch) => batch.advisories);

		// the over-cap function rode along as context
		expect(advisories.length > 0).toBeTruthy();
		// only size advisories are context — dead-export and filename advisories must
		// not ride in as if they were work: they'd read as a work-list the agent is
		// judged against
		expect([...new Set(advisories.map((advisory) => advisory.detector))]).toStrictEqual(['size']);
		// advisories are never batched as work
		expect([...new Set(worklist.batches.flatMap((batch) => batch.findings.map((finding) => finding.severity)))]).toStrictEqual(['finding']);
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
		expect(result.before['structure']).toBe(1);
		// and it burned down
		expect(result.after['structure'] ?? 0).toBe(0);
		// the batch reached an agent
		expect(prompts.length > 0).toBeTruthy();

		const worklist = readWorklist({ dir, plan: result.manifest.plan });

		// the mode is frozen with the work-list, so resume re-scans the same way
		expect(worklist.all).toBe(true);
	});

	test('a repo outside any git worktree is refused before any run state exists', async () => {
		const dir = setupConsumerRepo({ git: false });

		writeFileSync(join(dir, 'src/multi.ts'), multiExport);

		const driver: Driver = {
			name: 'stub',
			invoke: async () => {
				throw new Error('no agent may be spawned where the diff cannot be attributed');
			},
		};

		await expect(runRefactorPipeline({ cwd: dir, driver, config: await loadConfig({ cwd: dir }) })).rejects.toThrow(/requires a git worktree/);
	});
});
