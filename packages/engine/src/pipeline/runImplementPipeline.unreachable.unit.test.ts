import { mkdirSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from '@jest/globals';
import { expectDefined } from '@tests/helpers/expectDefined';
import { linkTypescript } from '@tests/helpers/linkTypescript';
import { report } from '@tests/helpers/report';
import { reviewReport } from '@tests/helpers/reviewReport';
import { roleOf } from '@tests/helpers/roleOf';
import { setupConsumerRepo } from '@tests/helpers/setupConsumerRepo';
import { loadConfig } from '@/common/utils/loadConfig';
import type { Driver } from '@/drivers';
import { runImplementPipeline } from '@/pipeline';

interface SetupParams {
	/** Merged over the consumer repo's default gate commands. */
	scripts?: Record<string, string | false>;
	/** Writer behavior override; undefined falls back to landing one stub test file. */
	onWriteTests?: (params: { prompt: string }) => { text: string; exitCode: number } | undefined;
	/** Per-pass refactor behavior; undefined reports no changes. */
	onRefactor?: (params: { pass: number }) => { text: string; exitCode: number } | undefined;
}

/**
 * A consumer repo whose implement step lands a module with a barrel-hidden
 * orphan: `src/feature/index.ts` exports feature.ts only, and orphan.ts is
 * exported by nothing and imported by nothing — nothing public reaches it.
 */
const setupOrphanRun = async ({ scripts, onWriteTests, onRefactor }: SetupParams = {}) => {
	const dir = setupConsumerRepo({ scripts });

	linkTypescript({ dir });

	const writerPrompts: string[] = [];
	let refactorPass = 0;

	const driver: Driver = {
		name: 'stub',
		invoke: async ({ prompt }) => {
			const role = roleOf(prompt);

			if (role === 'standards-review') {
				return { text: reviewReport(), exitCode: 0 };
			}

			if (role === 'write-tests') {
				writerPrompts.push(prompt);

				const custom = onWriteTests?.({ prompt });

				if (custom) {
					return custom;
				}

				mkdirSync(join(dir, 'test'), { recursive: true });
				writeFileSync(join(dir, 'test/feature.test.js'), '// stub\n');

				return { text: report({ changedFiles: [{ path: 'test/feature.test.js', summary: 'tests' }] }), exitCode: 0 };
			}

			if (role === 'refactor') {
				refactorPass += 1;

				return onRefactor?.({ pass: refactorPass }) ?? { text: report(), exitCode: 0 };
			}

			mkdirSync(join(dir, 'src/feature'), { recursive: true });
			writeFileSync(join(dir, 'src/feature/index.ts'), "export { feature } from './feature';\n");
			writeFileSync(join(dir, 'src/feature/feature.ts'), 'export const feature = () => 1;\n');
			writeFileSync(join(dir, 'src/feature/orphan.ts'), 'export const orphan = () => 2;\n');

			return {
				text: report({
					changedFiles: [
						{ path: 'src/feature/index.ts', summary: 'barrel' },
						{ path: 'src/feature/feature.ts', summary: 'public' },
						{ path: 'src/feature/orphan.ts', summary: 'hidden' },
					],
				}),
				exitCode: 0,
			};
		},
	};

	return { dir, driver, config: await loadConfig({ cwd: dir }), writerPrompts };
};

test('write-tests: a changed file nothing public reaches earns no writer, is recorded, and finishes the run under a named warning', async () => {
	const { dir, driver, config, writerPrompts } = await setupOrphanRun();

	const progress: string[] = [];
	const result = await runImplementPipeline({ cwd: dir, driver, config, planPath: 'plan.md', onProgress: (message) => progress.push(message) });

	expect(result.ok).toBe(true);
	// the public file earns exactly one writer; the orphan earns none
	expect(writerPrompts.length).toBe(1);
	expect(writerPrompts[0]?.includes('src/feature/feature.ts')).toBeTruthy();
	expect(writerPrompts[0]?.includes('src/feature/orphan.ts')).toBeFalsy();
	// the skip is narrated, naming the file
	expect(
		progress.some((line) => line.includes('1 changed file(s) skipped — nothing public reaches them') && line.includes('src/feature/orphan.ts')),
	).toBeTruthy();
	// both resolutions are persisted — verify fix re-invocations and resume read them back
	expect(result.manifest.testSubjects).toStrictEqual(['src/feature/feature.ts']);
	expect(result.manifest.unreachableChangedFiles).toStrictEqual(['src/feature/orphan.ts']);
	// still orphaned at the end of the run → the named warning, and the run still passes
	expect(
		progress.some((line) => line.startsWith('warning unreachable-changed-files: 1 changed file(s)') && line.includes('src/feature/orphan.ts')),
	).toBeTruthy();
});

test('a refactor pass that wires the orphan into the barrel clears the record at the end-of-run re-check — no warning survives', async () => {
	const { dir, driver, config } = await setupOrphanRun({
		onRefactor: ({ pass }) => {
			// the wiring pass: the barrel now exports the orphan, reconnecting it
			if (pass === 1) {
				writeFileSync(join(dir, 'src/feature/index.ts'), "export { feature } from './feature';\nexport { orphan } from './orphan';\n");

				return { text: report({ changedFiles: [{ path: 'src/feature/index.ts', summary: 'wired the orphan' }] }), exitCode: 0 };
			}

			return undefined;
		},
	});

	const progress: string[] = [];
	const result = await runImplementPipeline({ cwd: dir, driver, config, planPath: 'plan.md', onProgress: (message) => progress.push(message) });

	expect(result.ok).toBe(true);
	// write-tests recorded the orphan while it was still unreachable...
	expect(progress.some((line) => line.includes('nothing public reaches them') && line.includes('src/feature/orphan.ts'))).toBeTruthy();
	// ...but the re-check sees the new wiring and clears the record
	expect(result.manifest.unreachableChangedFiles).toStrictEqual([]);
	expect(progress.some((line) => line.startsWith('warning unreachable-changed-files'))).toBeFalsy();
});

test('a refactor pass that deletes the orphan clears the record too — a file gone from the tree has nothing left to warn about', async () => {
	const { dir, driver, config } = await setupOrphanRun({
		onRefactor: ({ pass }) => {
			// the other resolution of dead code: delete it rather than wire it
			if (pass === 1) {
				unlinkSync(join(dir, 'src/feature/orphan.ts'));

				return { text: report({ changedFiles: [{ path: 'src/feature/orphan.ts', summary: 'deleted the unreachable file' }] }), exitCode: 0 };
			}

			return undefined;
		},
	});

	const progress: string[] = [];
	const result = await runImplementPipeline({ cwd: dir, driver, config, planPath: 'plan.md', onProgress: (message) => progress.push(message) });

	expect(result.ok).toBe(true);
	// write-tests recorded the orphan while it was still on disk...
	expect(progress.some((line) => line.includes('nothing public reaches them') && line.includes('src/feature/orphan.ts'))).toBeTruthy();
	// ...and the re-check drops a file no longer in the tree instead of re-resolving it
	expect(result.manifest.unreachableChangedFiles).toStrictEqual([]);
	expect(progress.some((line) => line.startsWith('warning unreachable-changed-files'))).toBeFalsy();
});

test('verify-tests failure: the fix re-invocation is rebuilt from the manifest — recorded subjects in, unreachable files out', async () => {
	// the test gate is green until the writer drops BROKEN; the fix removes it
	const { dir, driver, config, writerPrompts } = await setupOrphanRun({
		scripts: { test: 'test ! -f BROKEN' },
		onWriteTests: ({ prompt }) => {
			if (prompt.includes('# Verification failure')) {
				unlinkSync(join(dir, 'BROKEN'));

				return { text: report(), exitCode: 0 };
			}

			writeFileSync(join(dir, 'BROKEN'), 'x');

			return undefined;
		},
	});

	const result = await runImplementPipeline({ cwd: dir, driver, config, planPath: 'plan.md' });

	expect(result.ok).toBe(true);

	const fixPrompt = writerPrompts.find((prompt) => prompt.includes('# Verification failure'));

	expectDefined(fixPrompt);
	// the subjects come back from the manifest, not a re-resolution
	expect(fixPrompt.includes('# Test subjects — write tests through these public surfaces\n\n- src/feature/feature.ts')).toBeTruthy();
	// the changed public file is still on the must-execute list...
	expect(fixPrompt.includes('# Changed internals that must execute under those tests')).toBeTruthy();
	// ...and the unreachable file is filtered out of the whole assignment
	expect(fixPrompt.includes('src/feature/orphan.ts')).toBeFalsy();
	// one cheap retry healed the gate
	expect(result.manifest.steps.find((step) => step.id === 'verify-tests')?.attempts).toBe(2);
});
