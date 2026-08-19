import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from '@jest/globals';
import { setupConsumerRepo } from '@tests/helpers/setupConsumerRepo';
import { runDoctor } from '@/doctor';

const passingProbe = async () => ({ exitCode: 0, stdout: '2.1.201 (Claude Code)\n', stderr: '' });

const byId = (checks: Awaited<ReturnType<typeof runDoctor>>) => new Map(checks.map((check) => [check.id, check]));

// Each check's own behavior is pinned beside it under checks/ — what this file
// owns is the orchestration: config handling, package resolution, which checks
// run at all, and the order the report comes back in.

test('doctor passes a healthy consumer repo, and the optional checks with nothing to say emit no line at all', async () => {
	const dir = setupConsumerRepo();

	writeFileSync(join(dir, '.gitignore'), '.lightsout\n');

	const checks = byId(await runDoctor({ cwd: dir, probeHarness: passingProbe }));

	expect(checks.get('config')?.status).toBe('pass');
	// a config with no harness key reports the default by name
	expect(checks.get('config')?.detail ?? '').toMatch(/harness claude-code/);
	// a config with no scoped gates is not announced as a monorepo
	expect(checks.get('config')?.detail ?? '').not.toMatch(/monorepo/);
	expect(checks.get('harness')?.status).toBe('pass');
	expect(checks.get('gitignore')?.status).toBe('pass');
	expect(checks.get('script-binaries')?.status).toBe('pass');

	// A single-package repo has no scoped gates, no Jest config, and no
	// testing-library to weigh in on — silence, not empty passes.
	expect(checks.get('scoped-gates')).toBe(undefined);
	expect(checks.get('jest-mocks')).toBe(undefined);
	expect(checks.get('user-event')).toBe(undefined);
});

test('doctor fails hard on an invalid config and checks nothing else', async () => {
	const dir = setupConsumerRepo({ git: false });

	writeFileSync(join(dir, 'lightsout.config.json'), '{ "scripts": {} }');

	const checks = await runDoctor({ cwd: dir, probeHarness: passingProbe });

	expect(checks.length).toBe(1);
	expect(checks[0]?.id).toBe('config');
	expect(checks[0]?.status).toBe('fail');
});

test('doctor names the configured global harness in the config check detail', async () => {
	const dir = setupConsumerRepo({ git: false, config: { harness: 'codex' } });
	const checks = byId(await runDoctor({ cwd: dir, probeHarness: passingProbe }));

	expect(checks.get('config')?.status).toBe('pass');
	expect(checks.get('config')?.detail ?? '').toMatch(/harness codex/);
});

test('doctor announces monorepo mode and the packages directory in the config check detail', async () => {
	const dir = setupConsumerRepo({
		git: false,
		config: {
			packagesDir: 'apps',
			packageGates: { check: 'pnpm --filter {package} run check', test: 'pnpm --filter {package} run test:unit' },
		},
	});

	const checks = byId(await runDoctor({ cwd: dir, probeHarness: passingProbe }));

	expect(checks.get('config')?.status).toBe('pass');
	// scoped gates are what make a repo a monorepo to the doctor, and the
	// directory it names is the configured one, not the default
	expect(checks.get('config')?.detail ?? '').toMatch(/monorepo \(apps\/\)/);
});

test('doctor passes scoped-gates when every package defines every scoped gate script', async () => {
	const dir = setupConsumerRepo({
		git: false,
		config: {
			packageGates: { check: 'pnpm --filter {package} run check', test: 'pnpm --filter {package} run test:unit' },
		},
	});

	mkdirSync(join(dir, 'packages/api'), { recursive: true });
	writeFileSync(join(dir, 'packages/api/package.json'), JSON.stringify({ name: '@acme/api', scripts: { check: 'x', 'test:unit': 'x' } }));

	const checks = byId(await runDoctor({ cwd: dir, probeHarness: passingProbe }));

	expect(checks.get('scoped-gates')?.status).toBe('pass');
	expect(checks.get('scoped-gates')?.detail ?? '').toMatch(/every package defines every scoped gate/);
});

test('doctor names a package that skips a scoped gate, so intent and typo stay distinguishable', async () => {
	const dir = setupConsumerRepo({
		git: false,
		config: {
			packageGates: { check: 'pnpm --filter {package} run check', test: 'pnpm --filter {package} run test:unit' },
		},
	});

	mkdirSync(join(dir, 'packages/infra'), { recursive: true });
	writeFileSync(join(dir, 'packages/infra/package.json'), JSON.stringify({ name: '@acme/infra' }));

	const checks = byId(await runDoctor({ cwd: dir, probeHarness: passingProbe }));

	// skips are a decision to surface, not a defect to nag about
	expect(checks.get('scoped-gates')?.status).toBe('note');
	expect(checks.get('scoped-gates')?.detail ?? '').toMatch(/infra \(check, test:unit\)/);
	expect(checks.get('scoped-gates')?.detail ?? '').toContain("a typo'd script name looks identical");
});

test('doctor treats only manifest-bearing, non-dot directories as packages', async () => {
	const dir = setupConsumerRepo({
		git: false,
		config: {
			packageGates: { check: 'pnpm --filter {package} run check', test: 'pnpm --filter {package} run test:unit' },
		},
	});

	mkdirSync(join(dir, 'packages/api'), { recursive: true });
	writeFileSync(join(dir, 'packages/api/package.json'), JSON.stringify({ name: '@acme/api', scripts: { check: 'x', 'test:unit': 'x' } }));

	// No manifest — nothing a scoped gate could ever address.
	mkdirSync(join(dir, 'packages/scratch'), { recursive: true });
	writeFileSync(join(dir, 'packages/scratch/jest.config.js'), 'module.exports = {};\n');

	// A tooling cache is not a package either, manifest or not.
	mkdirSync(join(dir, 'packages/.turbo'), { recursive: true });
	writeFileSync(join(dir, 'packages/.turbo/package.json'), JSON.stringify({ name: '@acme/cache' }));
	writeFileSync(join(dir, 'packages/.turbo/jest.config.js'), 'module.exports = {};\n');

	const checks = byId(await runDoctor({ cwd: dir, probeHarness: passingProbe }));

	// a skipped directory is never reported as a package missing its gate script
	expect(checks.get('scoped-gates')?.status).toBe('pass');
	// Jest configs under a non-package directory are never read
	expect(checks.get('jest-mocks')).toBe(undefined);
});

test('doctor orders checks positives-first: pass, then note, then warn/fail', async () => {
	const dir = setupConsumerRepo({
		config: {
			packageGates: {
				check: 'pnpm --filter {package} run check',
				test: 'pnpm --filter {package} run test:unit',
			},
		},
	});

	writeFileSync(join(dir, '.gitignore'), 'node_modules\n'); // warn: run state not ignored
	mkdirSync(join(dir, 'packages/infra'), { recursive: true });
	writeFileSync(join(dir, 'packages/infra/package.json'), JSON.stringify({ name: '@acme/infra' })); // note: skips

	const checks = await runDoctor({ cwd: dir, probeHarness: passingProbe });
	const ranks = checks.map((check) => ({ pass: 0, note: 1, warn: 2, fail: 3 })[check.status]);

	expect([...ranks].sort((a, b) => a - b)).toStrictEqual(ranks);
	// fixture produced both a note and a warn
	expect(ranks.includes(1) && ranks.includes(2)).toBeTruthy();
});
