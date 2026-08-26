import { execSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from '@jest/globals';
import { readConfig } from '#src/common/config/readConfig.ts';
import type { Driver } from '#src/drivers/index.ts';
import { runImplementPipeline } from '#src/pipeline/index.ts';
import { linkTypescript } from '#tests/helpers/linkTypescript.ts';
import { report } from '#tests/helpers/report.ts';
import { reviewReport } from '#tests/helpers/reviewReport.ts';
import { roleOf } from '#tests/helpers/roleOf.ts';
import { reachabilityRulesOff, setupConsumerRepo } from '#tests/helpers/setupConsumerRepo.ts';

interface SetupParams {
	/**
	 * Plant an ordinary barrelled module beside the route tree: `src/feature/`
	 * publishes feature.ts and hides helper.ts.
	 */
	withPlainModule?: boolean;
}

/**
 * A consumer repo that declares a file-based router in its manifest — the fact
 * the standards pack keys its framework answers on — and whose implement step
 * lands a route tree: `src/routes/index.tsx` is the index ROUTE and
 * `src/routes/runs.tsx` is a second route beside it. Nothing exports either and
 * nothing imports either; the router is what reaches them.
 */
const setupRouteTreeRun = async ({ withPlainModule = false }: SetupParams = {}) => {
	// a route tree is unconsumed by construction, and so is the hidden helper the
	// plain module carries — leaving the rules that ask "does anything consume
	// this?" on would report the fixture's own premise as work to do before the
	// run ever reached the question the test asks.
	const dir = setupConsumerRepo({ config: reachabilityRulesOff });

	// The manifest is what the pack reads: `@tanstack/react-router` is why
	// `src/routes/` is a router root here and an ordinary folder in a repo that
	// declares nothing. Committed, so the run still starts from a clean tree.
	writeFileSync(join(dir, 'package.json'), `${JSON.stringify({ name: 'consumer', dependencies: { '@tanstack/react-router': '^1.0.0' } })}\n`);
	execSync('git add -A && git -c user.name=t -c user.email=t@t commit -qm manifest', { cwd: dir });
	linkTypescript({ dir });

	const writerPrompts: string[] = [];
	const driver: Driver = {
		name: 'stub',
		invoke: async ({ prompt }) => {
			const role = roleOf(prompt);

			if (role === 'standards-review') {
				return { text: reviewReport(), exitCode: 0 };
			}

			if (role === 'write-tests') {
				writerPrompts.push(prompt);
				mkdirSync(join(dir, 'test'), { recursive: true });
				writeFileSync(join(dir, `test/subjects-${writerPrompts.length}.test.js`), '// stub\n');

				return { text: report({ changedFiles: [{ path: `test/subjects-${writerPrompts.length}.test.js`, summary: 'tests' }] }), exitCode: 0 };
			}

			if (role === 'refactor') {
				return { text: report(), exitCode: 0 };
			}

			mkdirSync(join(dir, 'src/routes'), { recursive: true });
			writeFileSync(join(dir, 'src/routes/index.tsx'), "export const Route = { path: '/', title: 'runs' };\n");
			writeFileSync(join(dir, 'src/routes/runs.tsx'), "export const Route = { path: '/runs', title: 'run detail' };\n");

			const routeFiles = [
				{ path: 'src/routes/index.tsx', summary: 'index route' },
				{ path: 'src/routes/runs.tsx', summary: 'runs route' },
			];

			if (!withPlainModule) {
				return { text: report({ changedFiles: routeFiles }), exitCode: 0 };
			}

			mkdirSync(join(dir, 'src/feature'), { recursive: true });
			writeFileSync(join(dir, 'src/feature/index.ts'), "export { feature } from './feature';\n");
			writeFileSync(join(dir, 'src/feature/feature.ts'), 'export const feature = (): number => 1;\n');
			// hidden behind the barrel on purpose: an ordinary module's index file is
			// still a barrel, whatever the router root's is
			writeFileSync(join(dir, 'src/feature/helper.ts'), 'export const helper = (): number => 2;\n');

			return {
				text: report({
					changedFiles: [
						...routeFiles,
						{ path: 'src/feature/index.ts', summary: 'barrel' },
						{ path: 'src/feature/feature.ts', summary: 'public' },
						{ path: 'src/feature/helper.ts', summary: 'hidden' },
					],
				}),
				exitCode: 0,
			};
		},
	};

	return { dir, driver, config: await readConfig({ cwd: dir }), writerPrompts };
};

describe('runImplementPipeline', () => {
	test('a router root loses no route behind its index file — every route file is its own test subject', async () => {
		const { dir, driver, config, writerPrompts } = await setupRouteTreeRun();

		const progress: string[] = [];
		const result = await runImplementPipeline({ cwd: dir, driver, config, planPath: 'plan.md', onProgress: (message) => progress.push(message) });

		expect(result.ok).toBe(true);
		// read as a barrel, index.tsx publishes nothing and hides runs.tsx, so
		// neither file would have a public surface reaching it
		expect(result.manifest.testSubjects).toStrictEqual(['src/routes/index.tsx', 'src/routes/runs.tsx']);
		expect(result.manifest.unreachableChangedFiles).toStrictEqual([]);
		expect(writerPrompts.some((prompt) => prompt.includes('src/routes/index.tsx'))).toBeTruthy();
		expect(writerPrompts.some((prompt) => prompt.includes('src/routes/runs.tsx'))).toBeTruthy();
		expect(progress.some((line) => line.startsWith('warning unreachable-changed-files'))).toBeFalsy();
	});

	test('an ordinary barrel beside the route tree still hides its own internals — the router fact silences one folder, not every index file', async () => {
		const { dir, driver, config } = await setupRouteTreeRun({ withPlainModule: true });

		const progress: string[] = [];
		const result = await runImplementPipeline({ cwd: dir, driver, config, planPath: 'plan.md', onProgress: (message) => progress.push(message) });

		expect(result.ok).toBe(true);
		expect(result.manifest.testSubjects).toStrictEqual(['src/feature/feature.ts', 'src/routes/index.tsx', 'src/routes/runs.tsx']);
		// the barrel-hidden helper is the only file nothing public reaches, and the
		// end-of-run re-check agrees with write-tests about which one that is
		expect(result.manifest.unreachableChangedFiles).toStrictEqual(['src/feature/helper.ts']);
		expect(
			progress.some((line) => line.startsWith('warning unreachable-changed-files: 1 changed file(s)') && line.includes('src/feature/helper.ts')),
		).toBeTruthy();
		expect(progress.some((line) => line.startsWith('warning unreachable-changed-files') && line.includes('src/routes/'))).toBeFalsy();
	});
});
