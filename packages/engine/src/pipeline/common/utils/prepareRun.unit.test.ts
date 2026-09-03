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
	'standards-packs': false,
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

	test('an unconfigured monorepo scopes against the packages/ layout, and its failure tells the reader to reference that', async () => {
		const { run, cwd } = await setupRun({ config: monorepo });

		write({ cwd, path: 'plan.md', content: '# Plan\n\nRewrite `apps/web/src/index.ts`.\n' });

		const prepared = await prepareRun({ run, cwd, config: monorepo, packages: undefined });

		// apps/web is not a package here — with no packages-dir configured the run
		// resolves against packages/, and the fix it suggests has to say so
		expect('error' in prepared && prepared.error).toContain('reference concrete packages/<name>/ paths');
	});

	test('a monorepo laid out under a configured packages-dir takes its scope from the paths there', async () => {
		const config: LightsoutConfig = { ...monorepo, 'packages-dir': 'apps' };
		const { run, cwd, progress } = await setupRun({ config });

		write({ cwd, path: 'plan.md', content: '# Plan\n\nRewrite `apps/web/src/index.ts`.\n' });

		await prepareRun({ run, cwd, config, packages: undefined });

		expect(run.current().packages).toStrictEqual(['web']);
		expect(run.current().packagesSource).toBe(PackagesSource.PlanPaths);
		expect(progress).toContain('package scope: web (from plan-paths)');
	});

	test('package names the plan body invents are dropped, and the run says which', async () => {
		const { run, cwd, progress } = await setupRun({ config: monorepo });

		write({ cwd, path: 'packages/billing/package.json', content: JSON.stringify({ name: 'billing' }) });
		write({ cwd, path: 'packages/web/package.json', content: JSON.stringify({ name: 'web' }) });
		write({ cwd, path: 'plan.md', content: '# Plan\n\nEdit `packages/billing/src/index.ts`, mirroring `packages/ghost/src/x.ts`.\n' });

		await prepareRun({ run, cwd, config: monorepo, packages: undefined });

		expect(run.current().packages).toStrictEqual(['billing']);
		expect(progress).toContain('ignored plan package paths: ghost — no such package under packages/');
	});

	test('a --packages flag naming a package that does not exist stops the run before any gate', async () => {
		const { run, cwd } = await setupRun({ config: monorepo });

		write({ cwd, path: 'packages/billing/package.json', content: JSON.stringify({ name: 'billing' }) });
		write({ cwd, path: 'packages/web/package.json', content: JSON.stringify({ name: 'web' }) });
		write({ cwd, path: 'plan.md', content: '# Plan\n' });

		const prepared = await prepareRun({ run, cwd, config: monorepo, packages: ['ghost'] });

		// a typo caught here beats nine gates running against a scope that cannot work
		expect('error' in prepared && prepared.error).toBe('package scope names ghost — no such package under packages/. Packages that exist: billing, web.');
		expect(run.current().packages).toStrictEqual([]);
	});

	test('a front-matter list naming a package that does not exist fails the same way', async () => {
		const { run, cwd } = await setupRun({ config: monorepo });

		write({ cwd, path: 'packages/billing/package.json', content: JSON.stringify({ name: 'billing' }) });
		write({ cwd, path: 'packages/web/package.json', content: JSON.stringify({ name: 'web' }) });
		write({ cwd, path: 'plan.md', content: '---\npackages:\n  - ghost\n---\n# Plan\n' });

		const prepared = await prepareRun({ run, cwd, config: monorepo, packages: undefined });

		expect('error' in prepared && prepared.error).toBe('package scope names ghost — no such package under packages/. Packages that exist: billing, web.');
	});

	test('a configured packages-dir is the one the names are reconciled against', async () => {
		const config: LightsoutConfig = { ...monorepo, 'packages-dir': 'apps' };
		const { run, cwd, progress } = await setupRun({ config });

		write({ cwd, path: 'apps/web/package.json', content: JSON.stringify({ name: 'web' }) });
		write({ cwd, path: 'plan.md', content: '# Plan\n\nRewrite `apps/web/src/index.ts` the way `apps/ghost/src/x.ts` does it.\n' });

		await prepareRun({ run, cwd, config, packages: undefined });

		expect(run.current().packages).toStrictEqual(['web']);
		expect(progress).toContain('ignored plan package paths: ghost — no such package under apps/');
	});

	test('a missing plan is reported rather than thrown, so the run records why it stopped', async () => {
		const { run, cwd } = await setupRun({ config: monorepo });

		const prepared = await prepareRun({ run, cwd, config: monorepo, packages: undefined });

		expect('error' in prepared && prepared.error).toContain('plan file not found');
	});

	test('a declared standards pack that is missing is reported the same way', async () => {
		const config: LightsoutConfig = { ...plainRepo, 'standards-packs': ['standards/ghost'] };
		const { run, cwd } = await setupRun({ config });

		write({ cwd, path: 'plan.md', content: '# Plan\n' });

		const prepared = await prepareRun({ run, cwd, config, packages: undefined });

		// loading standards throws; the run has to end with a truthful manifest
		expect('error' in prepared && prepared.error).toContain('standards pack root file not found');
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
