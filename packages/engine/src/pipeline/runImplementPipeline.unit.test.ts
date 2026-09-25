import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from '@jest/globals';
import { readConfig } from '#src/common/config/readConfig.ts';
import type { Driver } from '#src/drivers/common/types/Driver.ts';
import { runImplementPipeline } from '#src/pipeline/runImplementPipeline.ts';
import { readFriction } from '#src/runState/readFriction.ts';
import { readRunManifest } from '#src/runState/readRunManifest.ts';
import { report } from '#tests/helpers/report.ts';
import { roleOf } from '#tests/helpers/roleOf.ts';
import { setupConsumerRepo } from '#tests/helpers/setupConsumerRepo.ts';
import { withTestChangeReview } from '#tests/helpers/withTestChangeReview.ts';
import { writeSource } from '#tests/helpers/writeSource.ts';

test('implement that changes nothing fails instead of passing vacuously', async () => {
	const dir = setupConsumerRepo();
	const driver: Driver = { name: 'stub', invoke: async () => ({ text: report(), exitCode: 0 }) };
	const result = await runImplementPipeline({ cwd: dir, driver, config: await readConfig({ cwd: dir }), planPath: 'plan.md' });

	expect(result.ok).toBe(false);
	expect(result.manifest.status).toBe('failed');
	expect(result.error ?? '').toMatch(/nothing was implemented/);
});

test('non-git directory degrades to agent-reported files', async () => {
	const dir = setupConsumerRepo({ git: false });
	const driver: Driver = {
		name: 'stub',
		invoke: withTestChangeReview({
			invoke: async ({ prompt }) => {
				if (roleOf(prompt) !== 'implement') {
					return { text: report(), exitCode: 0 };
				}

				writeSource({ dir, path: 'src/feature.js', source: 'export const feature = () => 2;\n' });

				return { text: report({ changedFiles: [{ path: 'src/feature.js', summary: 'feature' }] }), exitCode: 0 };
			},
		}),
	};
	const result = await runImplementPipeline({ cwd: dir, driver, config: await readConfig({ cwd: dir }), planPath: 'plan.md' });

	// every step still ran and the agent's own report is still what the manifest
	// records, which is what "degrades" means here
	expect(result.manifest.changedFiles.includes('src/feature.js')).toBeTruthy();
	expect(result.manifest.steps.every((step) => step.status === 'passed')).toBe(true);
	// the run itself ends failed, because it now commits what it built and there
	// is no git here to commit to — a tree git cannot read is never read as one
	// holding no changes
	expect(result.ok).toBe(false);
	expect(result.error ?? '').toContain(dir);
});

test('friction lands in friction.jsonl with run/step provenance; decisions keep their kind', async () => {
	const dir = setupConsumerRepo();
	const driver: Driver = {
		name: 'stub',
		invoke: withTestChangeReview({
			invoke: async ({ prompt }) => {
				if (roleOf(prompt) !== 'implement') {
					return { text: report(), exitCode: 0 };
				}

				writeSource({ dir, path: 'src/feature.js', source: 'export const feature = () => 2;\n' });

				return {
					text: report({
						changedFiles: [{ path: 'src/feature.js', summary: 'feature' }],
						friction: [{ kind: 'decision', area: 'plan', detail: 'FRICTION-SENTINEL' }],
					}),
					exitCode: 0,
				};
			},
		}),
	};
	const result = await runImplementPipeline({ cwd: dir, driver, config: await readConfig({ cwd: dir }), planPath: 'plan.md' });
	const entries = await readFriction({ cwd: dir });
	const entry = entries.find((candidate) => candidate.detail === 'FRICTION-SENTINEL');

	expect(result.ok).toBe(true);
	// friction entry persisted
	expect(entry).toBeTruthy();
	expect(entry?.runId).toBe(result.manifest.runId);
	expect(entry?.step).toBe('implement');
	expect(entry?.kind).toBe('decision');
	// timestamp is a valid date
	expect(entry?.at && !Number.isNaN(Date.parse(entry.at))).toBeTruthy();
});

test('config timeouts reach the driver; defaults are 60m agent / 15m supervisor', async () => {
	const run = async ({ config }: { config: Record<string, unknown> }) => {
		const dir = setupConsumerRepo({ config });
		let received: number | undefined;
		const driver: Driver = {
			name: 'stub',
			invoke: async ({ timeoutMs }) => {
				received ??= timeoutMs;

				return { text: report({ status: 'failed', failures: ['stop early'] }), exitCode: 0 };
			},
		};

		await runImplementPipeline({ cwd: dir, driver, config: await readConfig({ cwd: dir }), planPath: 'plan.md' });

		return received;
	};

	// default agent ceiling is 60 minutes
	expect(await run({ config: {} })).toBe(60 * 60_000);
	// configured ceiling reaches the driver
	expect(await run({ config: { timeouts: { 'agent-minutes': 33 } } })).toBe(33 * 60_000);
});

test('missing plan file fails the run before any agent spawns', async () => {
	const dir = setupConsumerRepo();
	const driver: Driver = {
		name: 'stub',
		invoke: async () => {
			throw new Error('no agent should be invoked');
		},
	};
	const result = await runImplementPipeline({
		cwd: dir,
		driver,
		config: await readConfig({ cwd: dir }),
		planPath: 'ghost.md',
	});

	expect(result.manifest.status).toBe('failed');
	expect(result.error ?? '').toMatch(/plan file not found: .*ghost\.md/);
});

test('a change with no testable source skips both write-tests and refactor, and still passes', async () => {
	const dir = setupConsumerRepo();
	const driver: Driver = {
		name: 'stub',
		invoke: withTestChangeReview({
			invoke: async ({ prompt }) => {
				if (roleOf(prompt) !== 'implement') {
					return { text: report(), exitCode: 0 };
				}

				// The only change is a doc — real changed-file truth, but nothing a
				// test writer or refactorer can act on.
				writeFileSync(join(dir, 'docs.md'), '# docs\n');

				return { text: report({ changedFiles: [{ path: 'docs.md', summary: 'docs' }] }), exitCode: 0 };
			},
		}),
	};
	const result = await runImplementPipeline({ cwd: dir, driver, config: await readConfig({ cwd: dir }), planPath: 'plan.md' });

	expect(result.ok).toBe(true);
	// the doc change is still attributed
	expect(result.manifest.changedFiles.includes('docs.md')).toBeTruthy();

	const stepReport = (id: string) => result.manifest.steps.find((step) => step.id === id)?.report;

	expect(stepReport('write-tests')).toStrictEqual({ skipped: 'no eligible source files' });
	expect(stepReport('refactor')).toStrictEqual({ skipped: 'no changed source files to review' });
	// the verify after a skipped refactor still runs
	expect(result.manifest.steps.find((step) => step.id === 'verify-refactor')?.status).toBe('passed');
});

test('missing overview file fails the run before any agent spawns', async () => {
	const dir = setupConsumerRepo();
	const driver: Driver = {
		name: 'stub',
		invoke: async () => {
			throw new Error('no agent should be invoked');
		},
	};
	const result = await runImplementPipeline({
		cwd: dir,
		driver,
		config: await readConfig({ cwd: dir }),
		planPath: 'plan.md',
		overviewPath: 'missing-overview.md',
	});

	expect(result.manifest.status).toBe('failed');
	expect(result.error ?? '').toMatch(/overview file not found/);
});

test('--skip-refactor omits the refactor steps; absent format command is skipped', async () => {
	const dir = setupConsumerRepo();
	const driver: Driver = {
		name: 'stub',
		invoke: withTestChangeReview({
			invoke: async ({ prompt }) => {
				if (roleOf(prompt) !== 'implement') {
					return { text: report(), exitCode: 0 };
				}

				writeSource({ dir, path: 'src/feature.js', source: 'export const feature = () => 2;\n' });

				return { text: report({ changedFiles: [{ path: 'src/feature.js', summary: 'feature' }] }), exitCode: 0 };
			},
		}),
	};
	const result = await runImplementPipeline({
		cwd: dir,
		driver,
		config: await readConfig({ cwd: dir }),
		planPath: 'plan.md',
		skipRefactor: true,
	});

	expect(result.ok).toBe(true);
	expect(result.manifest.steps.find((step) => step.id === 'refactor')).toBe(undefined);

	const formatSteps = result.manifest.steps.filter((step) => step.id.startsWith('format-'));

	expect(formatSteps.map((step) => step.id)).toStrictEqual(['format-implement', 'format-tests']);
	expect(formatSteps.every((step) => step.status === 'passed')).toBe(true);
	expect(formatSteps.map((step) => step.report)).toStrictEqual([{ skipped: 'no format command configured' }, { skipped: 'no format command configured' }]);
});

test('a run started with no plan path at all fails before any agent spawns', async () => {
	const dir = setupConsumerRepo();
	const driver: Driver = {
		name: 'stub',
		invoke: async () => {
			throw new Error('no agent should be invoked');
		},
	};
	const result = await runImplementPipeline({ cwd: dir, driver, config: await readConfig({ cwd: dir }) });

	expect(result.ok).toBe(false);
	expect(result.manifest.status).toBe('failed');
	// an omitted plan path is recorded as the empty path it is and read back as
	// a missing plan — never as an empty plan the agents would work from
	expect(result.manifest.plan).toBe('');
	expect(result.error ?? '').toMatch(/plan file not found/);
});

test('creates a fresh run under the run id it is given', async () => {
	const dir = setupConsumerRepo();
	const driver: Driver = {
		name: 'stub',
		invoke: withTestChangeReview({
			invoke: async ({ prompt }) => {
				if (roleOf(prompt) !== 'implement') {
					return { text: report(), exitCode: 0 };
				}

				writeSource({ dir, path: 'src/feature.js', source: 'export const feature = () => 2;\n' });

				return { text: report({ changedFiles: [{ path: 'src/feature.js', summary: 'feature' }] }), exitCode: 0 };
			},
		}),
	};
	const result = await runImplementPipeline({
		cwd: dir,
		driver,
		config: await readConfig({ cwd: dir }),
		planPath: 'plan.md',
		runId: '9f8e7d6c-1111-4222-8333-444455556666',
	});
	const onDisk = await readRunManifest({ cwd: dir, runId: '9f8e7d6c-1111-4222-8333-444455556666' });

	expect(result.ok).toBe(true);
	// the id the caller minted is the run that exists, so a ticket record naming
	// it names a run on disk
	expect(result.manifest.runId).toBe('9f8e7d6c-1111-4222-8333-444455556666');
	expect(onDisk.runId).toBe('9f8e7d6c-1111-4222-8333-444455556666');
});
