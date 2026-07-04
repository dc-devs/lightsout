import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { runDoctor } from '../src/index';
import { setupConsumerRepo } from './helpers/setupConsumerRepo';

const passingProbe = async () => ({ exitCode: 0, stdout: '2.1.201 (Claude Code)\n', stderr: '' });

const byId = (checks: Awaited<ReturnType<typeof runDoctor>>) => new Map(checks.map((check) => [check.id, check]));

test('doctor passes a healthy consumer repo', async () => {
	const dir = setupConsumerRepo({ git: false });

	writeFileSync(join(dir, '.gitignore'), '.lightsout/\n');

	const checks = byId(await runDoctor({ cwd: dir, probeHarness: passingProbe }));

	assert.equal(checks.get('config')?.status, 'pass');
	assert.equal(checks.get('harness')?.status, 'pass');
	assert.match(checks.get('harness')?.detail ?? '', /claude 2\.1\.201/);
	assert.equal(checks.get('gitignore')?.status, 'pass');
	assert.equal(checks.get('script-binaries')?.status, 'pass', checks.get('script-binaries')?.detail);
});

test('doctor fails hard on an invalid config and checks nothing else', async () => {
	const dir = setupConsumerRepo({ git: false });

	writeFileSync(join(dir, 'lightsout.config.json'), '{ "scripts": {} }');

	const checks = await runDoctor({ cwd: dir, probeHarness: passingProbe });

	assert.equal(checks.length, 1);
	assert.equal(checks[0]?.id, 'config');
	assert.equal(checks[0]?.status, 'fail');
});

test('doctor flags a broken harness binary with the probe output', async () => {
	const dir = setupConsumerRepo({ git: false });
	const checks = byId(
		await runDoctor({
			cwd: dir,
			probeHarness: async () => ({ exitCode: 1, stdout: '', stderr: 'spawn codex ENOENT' }),
		}),
	);

	assert.equal(checks.get('harness')?.status, 'fail');
	assert.match(checks.get('harness')?.detail ?? '', /ENOENT/);
});

test('doctor warns on missing gitignore entries, scriptless packages, jest configs without mock cleanup, and stale generated paths', async () => {
	const dir = setupConsumerRepo({
		git: false,
		config: {
			generated: ['packages/api/src/gen/', 'packages/api/schema.gql'],
			packageScripts: {
				check: 'pnpm --filter {package} run check',
				testUnit: 'pnpm --filter {package} run test:unit',
			},
		},
	});

	writeFileSync(join(dir, '.gitignore'), '.lightsout/runs/\nnode_modules\n');

	mkdirSync(join(dir, 'packages/api/src/gen'), { recursive: true });
	writeFileSync(join(dir, 'packages/api/package.json'), JSON.stringify({ name: '@acme/api', scripts: { check: 'x', 'test:unit': 'x' } }));
	writeFileSync(join(dir, 'packages/api/jest.config.js'), 'module.exports = { clearMocks: true };\n');

	mkdirSync(join(dir, 'packages/infra'), { recursive: true });
	writeFileSync(join(dir, 'packages/infra/package.json'), JSON.stringify({ name: '@acme/infra' }));

	const checks = byId(await runDoctor({ cwd: dir, probeHarness: passingProbe }));

	assert.equal(checks.get('gitignore')?.status, 'warn');
	assert.match(checks.get('gitignore')?.fix ?? '', /friction\.jsonl/);
	assert.match(checks.get('gitignore')?.fix ?? '', /lock\.json/);
	assert.ok(!(checks.get('gitignore')?.fix ?? '').includes('runs/'), 'already-present entry not re-suggested');

	assert.equal(checks.get('scoped-gates')?.status, 'warn');
	assert.match(checks.get('scoped-gates')?.detail ?? '', /infra \(check, test:unit\)/);

	assert.equal(checks.get('jest-mocks')?.status, 'warn');
	assert.match(checks.get('jest-mocks')?.detail ?? '', /api.*jest\.config\.js lacks restoreMocks/);

	assert.equal(checks.get('generated')?.status, 'warn');
	assert.match(checks.get('generated')?.detail ?? '', /schema\.gql/);
	assert.ok(!(checks.get('generated')?.detail ?? '').includes('src/gen'), 'existing generated path not flagged');
});

test('doctor finds jest configs nested under test/ and fails on missing gate binaries', async () => {
	const dir = setupConsumerRepo({
		git: false,
		scripts: { check: 'definitely-not-a-real-binary-xyz --version' },
	});

	writeFileSync(join(dir, '.gitignore'), '.lightsout/\n');
	mkdirSync(join(dir, 'test/config'), { recursive: true });
	writeFileSync(join(dir, 'test/config/jest.unit.config.js'), 'module.exports = { clearMocks: true, restoreMocks: true };\n');

	const checks = byId(await runDoctor({ cwd: dir, probeHarness: passingProbe }));

	assert.equal(checks.get('jest-mocks')?.status, 'pass');
	assert.equal(checks.get('script-binaries')?.status, 'fail');
	assert.match(checks.get('script-binaries')?.detail ?? '', /definitely-not-a-real-binary-xyz/);
});
