import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from '@jest/globals';
import { report } from '@tests/helpers/report';
import { reviewReport } from '@tests/helpers/reviewReport';
import { roleOf } from '@tests/helpers/roleOf';
import { setupConsumerRepo } from '@tests/helpers/setupConsumerRepo';
import { loadConfig } from '@/common/utils/loadConfig';
import type { Driver } from '@/drivers';
import { runImplementPipeline } from '@/pipeline';

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
			writeFileSync(join(dir, 'src/messy.js'), 'export const first = () => 1;\nexport const second = () => 2;\n');

			return { text: report({ changedFiles: [{ path: 'src/messy.js', summary: 'feature' }] }), exitCode: 0 };
		},
	};

	const progress: string[] = [];
	const result = await runImplementPipeline({
		cwd: dir,
		driver,
		config: await loadConfig({ cwd: dir }),
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

			writeFileSync(join(dir, 'src/messy.js'), 'export const first = () => 1;\nexport const second = () => 2;\n');

			return { text: report({ changedFiles: [{ path: 'src/messy.js', summary: 'feature' }] }), exitCode: 0 };
		},
	};

	const result = await runImplementPipeline({ cwd: dir, driver, config: await loadConfig({ cwd: dir }), planPath: 'plan.md' });

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
					writeFileSync(join(dir, 'src/alpha.js'), 'export const first = () => 1;\n');
				}

				return { text: report(), exitCode: 0 };
			}

			// Implement plants two violations in two files (two distinct clusters).
			writeFileSync(join(dir, 'src/alpha.js'), 'export const first = () => 1;\nexport const second = () => 2;\n');
			writeFileSync(join(dir, 'src/beta.js'), 'export const third = () => 3;\nexport const fourth = () => 4;\n');

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

	const result = await runImplementPipeline({ cwd: dir, driver, config: await loadConfig({ cwd: dir }), planPath: 'plan.md' });

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

		await runImplementPipeline({ cwd: dir, driver, config: await loadConfig({ cwd: dir }), planPath: 'plan.md' });

		return implementPrompt;
	};

	const defaulted = await run({ config: {} });

	// unspecified → standards section present
	expect(defaulted.includes('# Standards\n\nThese rules are binding')).toBeTruthy();
	// bundled defaults inlined
	expect(defaulted.includes('One Export Per File')).toBeTruthy();

	const disabled = await run({ config: { standardsPackages: false } });

	// false → no standards section
	expect(disabled.includes('# Standards\n\nThese rules are binding')).toBeFalsy();
});
