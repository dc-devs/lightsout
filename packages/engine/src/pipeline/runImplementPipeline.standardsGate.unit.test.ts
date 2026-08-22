import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from '@jest/globals';
import { readConfig } from '#src/common/config/readConfig.ts';
import type { Driver } from '#src/drivers/index.ts';
import { runImplementPipeline } from '#src/pipeline/index.ts';
import { report } from '#tests/helpers/report.ts';
import { reviewReport } from '#tests/helpers/reviewReport.ts';
import { roleOf } from '#tests/helpers/roleOf.ts';
import { setupConsumerRepo } from '#tests/helpers/setupConsumerRepo.ts';
import { writeSource } from '#tests/helpers/writeSource.ts';

// The standards gate: findings feed the refactor prompt, declines are judged
// by whether the gating set changed, and the config switch is honored.

test('standards gate: findings feed the refactor prompt; a fixing pass clears the gate', async () => {
	const dir = setupConsumerRepo();
	const prompts: string[] = [];

	const driver: Driver = {
		name: 'stub',
		invoke: async ({ prompt }) => {
			const role = roleOf(prompt);

			if (role === 'standards-review') {
				return { text: reviewReport(), exitCode: 0 };
			}

			if (role === 'write-tests') {
				mkdirSync(join(dir, 'test'), { recursive: true });
				writeFileSync(join(dir, 'test/messy.test.js'), '// stub\n');

				return { text: report({ changedFiles: [{ path: 'test/messy.test.js', summary: 'tests' }] }), exitCode: 0 };
			}

			if (role === 'refactor') {
				prompts.push(prompt);

				// First pass fixes the planted multi-export; later passes are clean.
				// The fixed file exports nothing at all, so no advisory (a filename
				// mismatch, an unconsumed export) survives to keep the section alive.
				if (prompts.length === 1) {
					writeFileSync(join(dir, 'src/messy.js'), "import { one } from './index.js';\n\nconsole.log(one);\n");

					return { text: report({ changedFiles: [{ path: 'src/messy.js', summary: 'split exports' }] }), exitCode: 0 };
				}

				return { text: report(), exitCode: 0 };
			}

			// Implement plants a multi-export violation — the standards gate's target.
			writeSource({ dir, path: 'src/messy.js', source: 'export const first = () => 1;\nexport const second = () => 2;\n' });

			return { text: report({ changedFiles: [{ path: 'src/messy.js', summary: 'feature' }] }), exitCode: 0 };
		},
	};

	const progress: string[] = [];
	const result = await runImplementPipeline({
		cwd: dir,
		driver,
		config: await readConfig({ cwd: dir }),
		planPath: 'plan.md',
		onProgress: (message) => progress.push(message),
	});

	expect(result.ok).toBe(true);
	// gate narrated the finding — the work-list count IS the blocking count now,
	// so there is no second number to print
	expect(progress.some((line) => line.startsWith('standards gate: 1 blocking'))).toBeTruthy();
	// findings section injected into the refactor prompt
	expect(prompts[0]?.includes('# Standards findings')).toBeTruthy();
	// the planted violation named in the work-list
	expect(prompts[0]?.includes('[multi-export] src/messy.js')).toBeTruthy();
	// clean tree injects no findings section
	expect(prompts[1]?.includes('# Standards findings')).toBeFalsy();
});

test('standards gate: two identical declined passes escalate early — the third pass is never bought', async () => {
	const dir = setupConsumerRepo();
	let refactorInvocations = 0;

	const driver: Driver = {
		name: 'stub',
		invoke: async ({ prompt }) => {
			const role = roleOf(prompt);

			if (role === 'standards-review') {
				return { text: reviewReport(), exitCode: 0 };
			}

			if (role === 'write-tests') {
				mkdirSync(join(dir, 'test'), { recursive: true });
				writeFileSync(join(dir, 'test/messy.test.js'), '// stub\n');

				return { text: report({ changedFiles: [{ path: 'test/messy.test.js', summary: 'tests' }] }), exitCode: 0 };
			}

			if (role === 'refactor') {
				refactorInvocations += 1;

				// Reports clean without ever fixing the violation, and explains why.
				return {
					text: report({ friction: [{ kind: 'decision', area: 'plan', detail: 'finding kept: the split would break the public API' }] }),
					exitCode: 0,
				};
			}

			writeSource({ dir, path: 'src/messy.js', source: 'export const first = () => 1;\nexport const second = () => 2;\n' });

			return { text: report({ changedFiles: [{ path: 'src/messy.js', summary: 'feature' }] }), exitCode: 0 };
		},
	};

	const result = await runImplementPipeline({ cwd: dir, driver, config: await readConfig({ cwd: dir }), planPath: 'plan.md' });

	expect(result.ok).toBe(false);
	expect(result.manifest.status).toBe('escalated');
	// the second identical decline settles it — no third invocation
	expect(refactorInvocations).toBe(2);
	expect(result.error ?? '').toMatch(/standards gate — 1 blocking persist after 2 pass\(es\)/);
	expect(result.error ?? '').toMatch(/multi-export:src\/messy\.js/);
	// The escalation carries the evidence a human needs: the finding's detail
	// with its location, and the agent's own account of why it was left.
	expect(result.error ?? '').toMatch(/at src\/messy\.js/);
	expect(result.error ?? '').toMatch("the refactor agent's account of its final pass:");
	expect(result.error ?? '').toMatch(/finding kept: the split would break the public API/);
});

test('standards gate: a declined pass that still CHANGED the gating set earns the next pass', async () => {
	const dir = setupConsumerRepo();
	let refactorInvocations = 0;

	const driver: Driver = {
		name: 'stub',
		invoke: async ({ prompt }) => {
			const role = roleOf(prompt);

			if (role === 'standards-review') {
				return { text: reviewReport(), exitCode: 0 };
			}

			if (role === 'write-tests') {
				const target = prompt.match(/- (\S+)/)?.[1] ?? 'unknown';
				const testFile = `test/${target.split('/').pop()?.replace('.js', '')}.test.js`;

				mkdirSync(join(dir, 'test'), { recursive: true });
				writeFileSync(join(dir, testFile), '// stub\n');

				return { text: report({ changedFiles: [{ path: testFile, summary: 'tests' }] }), exitCode: 0 };
			}

			if (role === 'refactor') {
				refactorInvocations += 1;

				// Pass 1 quietly fixes one of the two violations ON DISK while
				// reporting zero changes — the gating set shrinks, so the
				// early-exit must NOT fire; passes 2 and 3 decline identically.
				if (refactorInvocations === 1) {
					writeSource({ dir, path: 'src/alpha.js', source: 'export const first = () => 1;\n' });
				}

				return { text: report(), exitCode: 0 };
			}

			// Implement plants two violations in two files (two distinct clusters).
			writeSource({ dir, path: 'src/alpha.js', source: 'export const first = () => 1;\nexport const second = () => 2;\n' });
			writeSource({ dir, path: 'src/beta.js', source: 'export const third = () => 3;\nexport const fourth = () => 4;\n' });

			return {
				text: report({
					changedFiles: [
						{ path: 'src/alpha.js', summary: 'feature' },
						{ path: 'src/beta.js', summary: 'feature' },
					],
				}),
				exitCode: 0,
			};
		},
	};

	const result = await runImplementPipeline({ cwd: dir, driver, config: await readConfig({ cwd: dir }), planPath: 'plan.md' });

	expect(result.ok).toBe(false);
	expect(result.manifest.status).toBe('escalated');
	// a shrinking gating set is progress — the full pass budget stays available
	expect(refactorInvocations).toBe(3);
	expect(result.error ?? '').toMatch(/persist after 3 pass\(es\)/);
	expect(result.error ?? '').toMatch(/multi-export:src\/beta\.js/);
	// the quietly-fixed violation is gone from the escalation
	expect(result.error ?? '').not.toMatch(/multi-export:src\/alpha\.js/);
});

test('standards default on when unspecified; false switches them off explicitly', async () => {
	const run = async ({ config }: { config: Record<string, unknown> }) => {
		const dir = setupConsumerRepo({ config });
		let implementPrompt = '';
		const driver: Driver = {
			name: 'stub',
			invoke: async ({ prompt, systemPrompt }) => {
				if (roleOf(prompt) === 'implement') {
					// Standards ride the system prompt — stable for the run, so cached.
					implementPrompt = systemPrompt ?? '';

					return { text: report({ status: 'failed', failures: ['stop early'] }), exitCode: 0 };
				}

				return { text: report(), exitCode: 0 };
			},
		};

		await runImplementPipeline({ cwd: dir, driver, config: await readConfig({ cwd: dir }), planPath: 'plan.md' });

		return implementPrompt;
	};

	const defaulted = await run({ config: {} });

	// unspecified → standards section present
	expect(defaulted.includes('# Standards\n\nThese rules are binding')).toBeTruthy();
	// bundled defaults inlined
	expect(defaulted.includes('One Export Per File')).toBeTruthy();

	const disabled = await run({ config: { 'standards-packs': false } });

	// false → no standards section
	expect(disabled.includes('# Standards\n\nThese rules are binding')).toBeFalsy();
});

test('a declared standards pack that cannot be loaded stops the run before any agent spawns', async () => {
	const dir = setupConsumerRepo({ config: { 'standards-packs': ['standards/ghost'] } });
	const driver: Driver = {
		name: 'stub',
		invoke: async () => {
			throw new Error('no agent should be invoked');
		},
	};
	const progress: string[] = [];

	const result = await runImplementPipeline({
		cwd: dir,
		driver,
		config: await readConfig({ cwd: dir }),
		planPath: 'plan.md',
		onProgress: (message) => progress.push(message),
	});

	// a consumer that declared standards and did not get them must not run: the
	// load failure comes back as a failed manifest, never as a thrown crash that
	// would leave the run with no record of why it ended
	expect(result.ok).toBe(false);
	expect(result.manifest.status).toBe('failed');
	expect(result.error ?? '').toMatch(/standards pack root file not found/);

	const cleanSlate = result.manifest.steps.find((step) => step.id === 'clean-slate');

	// the run stopped at the first step without ever attempting it — a zero
	// attempt count is what distinguishes "never started" from "ran and failed"
	expect(cleanSlate?.status).toBe('failed');
	expect(cleanSlate?.attempts).toBe(0);
	expect(progress.some((line) => line.startsWith('run stopped at clean-slate'))).toBeTruthy();
});

/**
 * A run whose implement step lands one clean source file and whose refactor
 * pass declines, so the config is the only thing left deciding what the
 * standards half of the gate does. The reviewer's system prompt is collected —
 * it carries the rules the pack and channel resolution selected, so it is where
 * a config the gate failed to honor shows up — and an empty list of prompts is
 * a review that was never bought at all.
 */
const setupStandardsConfigRun = async ({ config }: { config: Record<string, unknown> }) => {
	const dir = setupConsumerRepo({ config });
	const reviewSystemPrompts: string[] = [];
	const driver: Driver = {
		name: 'stub',
		invoke: async ({ prompt, systemPrompt }) => {
			const role = roleOf(prompt);

			if (role === 'standards-review') {
				reviewSystemPrompts.push(systemPrompt ?? '');

				return { text: reviewReport(), exitCode: 0 };
			}

			if (role === 'write-tests') {
				mkdirSync(join(dir, 'test'), { recursive: true });
				writeFileSync(join(dir, 'test/subject.test.js'), '// stub\n');

				return { text: report({ changedFiles: [{ path: 'test/subject.test.js', summary: 'tests' }] }), exitCode: 0 };
			}

			if (role === 'refactor') {
				return { text: report({ changedFiles: [] }), exitCode: 0 };
			}

			writeSource({ dir, path: 'src/subject.js', source: 'export const subject = () => 1;\n' });

			return { text: report({ changedFiles: [{ path: 'src/subject.js', summary: 'feature' }] }), exitCode: 0 };
		},
	};

	return { dir, driver, config: await readConfig({ cwd: dir }), reviewSystemPrompts };
};

test('standards packs off: the refactor gate loads no pack, spends no reviewer, and the loop still completes', async () => {
	const { dir, driver, config, reviewSystemPrompts } = await setupStandardsConfigRun({ config: { 'standards-packs': false } });

	const result = await runImplementPipeline({ cwd: dir, driver, config, planPath: 'plan.md' });

	// no pack means no judgment rule to read, so no agent is spent saying so —
	// and the machine half having nothing to report is what lets the loop finish
	expect(reviewSystemPrompts).toStrictEqual([]);
	expect(result.ok).toBe(true);
	expect(result.manifest.steps.find((step) => step.id === 'refactor')?.status).toBe('passed');
});

test('standards channels configured: the refactor gate hands the reviewer the named channel rather than what it would detect', async () => {
	const { dir, driver, config, reviewSystemPrompts } = await setupStandardsConfigRun({ config: { 'standards-channels': ['react'] } });

	await runImplementPipeline({ cwd: dir, driver, config, planPath: 'plan.md' });

	// the fixture repo carries no manifest at all, so detection would have found
	// no channel and left both of these documents out of the review entirely
	expect(reviewSystemPrompts[0] ?? '').toContain('## code/architecture/react');
	expect(reviewSystemPrompts[0] ?? '').toContain('## tests/unit-testing-react-components');
});
