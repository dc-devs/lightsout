import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { describe, expect, test } from '@jest/globals';
import { type LightsoutConfig, PackagesSource } from '#src/contracts/index.ts';
import type { Driver } from '#src/drivers/index.ts';
import { prepareRun } from '#src/pipeline/common/utils/prepareRun.ts';
import { PipelineRun } from '#src/pipeline/PipelineRun.ts';
import { createRun } from '#src/runState/index.ts';

const plainRepo: LightsoutConfig = { gates: { check: 'true', test: 'true', 'test-coverage': false } };
const monorepo: LightsoutConfig = {
	...plainRepo,
	'package-gates': { check: 'pnpm --filter {package} check', test: 'pnpm --filter {package} test' },
	'standards-packages': false,
};

const idleDriver: Driver = { name: 'stub', invoke: async () => ({ text: '', exitCode: 0 }) };

/** A real run over a temp repo — the scope it settles has to survive to disk. */
const setupRun = async ({ config }: { config: LightsoutConfig }) => {
	const cwd = mkdtempSync(join(tmpdir(), 'lightsout-prepare-run-'));
	const progress: string[] = [];
	const manifest = await createRun({ cwd, plan: 'plan.md', pipeline: 'implement', driver: idleDriver.name, config });

	return { cwd, progress, run: new PipelineRun({ cwd, config, driver: idleDriver, manifest, onProgress: (line) => progress.push(line) }) };
};

const write = ({ cwd, path, content }: { cwd: string; path: string; content: string }) => {
	mkdirSync(dirname(join(cwd, path)), { recursive: true });
	writeFileSync(join(cwd, path), content);
};

describe('prepareRun', () => {
	test('returns the plan text the steps are built from', async () => {
		const { run, cwd } = await setupRun({ config: { ...monorepo, 'package-gates': undefined } });

		write({ cwd, path: 'plan.md', content: '# Plan\nbody\n' });

		const prepared = await prepareRun({ run, cwd, config: run.config, packages: undefined });

		expect('error' in prepared ? undefined : prepared.planContent).toBe('# Plan\nbody\n');
	});

	test('persists the package scope to the manifest before any step runs', async () => {
		const { run, cwd, progress } = await setupRun({ config: monorepo });

		write({ cwd, path: 'plan.md', content: '---\npackages:\n  - api\n---\n# Plan\n' });

		await prepareRun({ run, cwd, config: monorepo, packages: undefined });

		// gates run scoped, so the scope has to survive a crash from here on
		expect(run.current().packages).toStrictEqual(['api']);
		expect(run.current().packagesSource).toBe(PackagesSource.FrontMatter);
		expect(progress).toContain('package scope: api (from front-matter)');
	});

	test('a monorepo run that cannot name its scope fails before spending anything', async () => {
		const { run, cwd } = await setupRun({ config: monorepo });

		write({ cwd, path: 'plan.md', content: '# Plan\nnothing concrete\n' });

		const prepared = await prepareRun({ run, cwd, config: monorepo, packages: undefined });

		expect('error' in prepared && prepared.error).toContain('no package scope could be resolved');
	});

	test('a missing plan is reported rather than thrown, so the run records why it stopped', async () => {
		const { run, cwd } = await setupRun({ config: monorepo });

		const prepared = await prepareRun({ run, cwd, config: monorepo, packages: undefined });

		expect('error' in prepared && prepared.error).toContain('plan file not found');
	});

	test('a declared standards package that is missing is reported the same way', async () => {
		const config: LightsoutConfig = { ...plainRepo, 'standards-packages': ['standards/ghost'] };
		const { run, cwd } = await setupRun({ config });

		write({ cwd, path: 'plan.md', content: '# Plan\n' });

		const prepared = await prepareRun({ run, cwd, config, packages: undefined });

		// loading standards throws; the run has to end with a truthful manifest
		expect('error' in prepared && prepared.error).toContain('standards package root file not found');
	});

	test('loads the standards the roles write against, announcing where the channels came from', async () => {
		const config = plainRepo;
		const { run, cwd, progress } = await setupRun({ config });

		write({ cwd, path: 'plan.md', content: '# Plan\n' });

		const prepared = await prepareRun({ run, cwd, config, packages: undefined });

		expect('error' in prepared ? undefined : prepared.standards).toContain('<!-- lightsout-defaults: code/');
		expect(progress.some((line) => line.startsWith('standards channels: base'))).toBe(true);
	});
});
