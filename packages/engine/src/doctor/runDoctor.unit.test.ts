import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { runDoctor } from '../index';
import { setupConsumerRepo } from '../../tests/helpers/setupConsumerRepo';

const passingProbe = async () => ({ exitCode: 0, stdout: '2.1.201 (Claude Code)\n', stderr: '' });

const byId = (checks: Awaited<ReturnType<typeof runDoctor>>) => new Map(checks.map((check) => [check.id, check]));

test('doctor passes a healthy consumer repo — gitignore judged by git, not by line-matching', async () => {
	const dir = setupConsumerRepo();

	// The bare-directory spelling (no trailing slash) that a real consumer
	// used and the old literal-line check false-warned on.
	writeFileSync(join(dir, '.gitignore'), '.lightsout\n');

	const checks = byId(await runDoctor({ cwd: dir, probeHarness: passingProbe }));

	assert.equal(checks.get('config')?.status, 'pass');
	assert.equal(checks.get('harness')?.status, 'pass');
	assert.match(checks.get('harness')?.detail ?? '', /claude 2\.1\.201/);
	assert.equal(checks.get('gitignore')?.status, 'pass', checks.get('gitignore')?.detail);
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

	assert.equal(checks.get('scoped-gates')?.status, 'note', 'skips are a decision to surface, not a defect to nag about');
	assert.match(checks.get('scoped-gates')?.detail ?? '', /infra \(check, test:unit\)/);
	assert.match(checks.get('scoped-gates')?.detail ?? '', /typo'd script name looks identical/);

	assert.equal(checks.get('jest-mocks')?.status, 'warn');
	assert.match(checks.get('jest-mocks')?.detail ?? '', /api.*jest\.config\.js lacks restoreMocks/);

	assert.equal(checks.get('generated')?.status, 'warn');
	assert.match(checks.get('generated')?.detail ?? '', /schema\.gql/);
	assert.ok(!(checks.get('generated')?.detail ?? '').includes('src/gen'), 'existing generated path not flagged');
});

test('doctor notes packages with @testing-library/react but no user-event — and stays silent for packages with both or neither', async () => {
	const dir = setupConsumerRepo({
		git: false,
		config: {
			packageScripts: { check: 'pnpm --filter {package} run check', testUnit: 'pnpm --filter {package} run test:unit' },
		},
	});
	const scripts = { check: 'x', 'test:unit': 'x' };

	mkdirSync(join(dir, 'packages/web-app'), { recursive: true });
	writeFileSync(
		join(dir, 'packages/web-app/package.json'),
		JSON.stringify({ name: '@acme/web-app', scripts, devDependencies: { '@testing-library/react': '^16.0.0' } }),
	);

	mkdirSync(join(dir, 'packages/widget'), { recursive: true });
	writeFileSync(
		join(dir, 'packages/widget/package.json'),
		JSON.stringify({
			name: '@acme/widget',
			scripts,
			devDependencies: { '@testing-library/preact': '^3.0.0', '@testing-library/user-event': '^14.0.0' },
		}),
	);

	mkdirSync(join(dir, 'packages/api'), { recursive: true });
	writeFileSync(join(dir, 'packages/api/package.json'), JSON.stringify({ name: '@acme/api', scripts }));

	const checks = byId(await runDoctor({ cwd: dir, probeHarness: passingProbe }));

	assert.equal(checks.get('user-event')?.status, 'note', 'a recommendation, not a defect');
	assert.match(checks.get('user-event')?.detail ?? '', /web-app/);
	assert.ok(!(checks.get('user-event')?.detail ?? '').includes('widget'), 'package already on user-event not flagged');
	assert.ok(!(checks.get('user-event')?.detail ?? '').includes('api'), 'package without testing-library not flagged');
});

test('doctor lint-rules: flags disabled mechanical rules, passes enforced ones, notes a missing linter, and respects standards:false', async () => {
	// Disabled + missing rules → note naming them
	const flagged = setupConsumerRepo({ git: false });

	writeFileSync(join(flagged, 'biome.json'), '{"linter":{"rules":{"style":{"useImportType":"off"}}}}');

	const flaggedChecks = byId(await runDoctor({ cwd: flagged, probeHarness: passingProbe }));

	assert.equal(flaggedChecks.get('lint-rules')?.status, 'note');
	assert.match(flaggedChecks.get('lint-rules')?.detail ?? '', /useImportType, noExplicitAny missing or disabled/);

	// Both rules on → pass
	const clean = setupConsumerRepo({ git: false });

	writeFileSync(join(clean, 'biome.json'), '{"linter":{"rules":{"style":{"useImportType":"error"},"suspicious":{"noExplicitAny":"error"}}}}');

	const cleanChecks = byId(await runDoctor({ cwd: clean, probeHarness: passingProbe }));

	assert.equal(cleanChecks.get('lint-rules')?.status, 'pass', cleanChecks.get('lint-rules')?.detail);

	// No linter at all → note
	const bare = setupConsumerRepo({ git: false });
	const bareChecks = byId(await runDoctor({ cwd: bare, probeHarness: passingProbe }));

	assert.equal(bareChecks.get('lint-rules')?.status, 'note');
	assert.match(bareChecks.get('lint-rules')?.detail ?? '', /no linter config found/);

	// standards: false = the consumer opted out — no check at all
	const yolo = setupConsumerRepo({ git: false, config: { standards: false } });
	const yoloChecks = byId(await runDoctor({ cwd: yolo, probeHarness: passingProbe }));

	assert.equal(yoloChecks.get('lint-rules'), undefined, 'opting out of standards opts out of the lint nudge');
});

test('doctor orders checks positives-first: pass, then note, then warn/fail', async () => {
	const dir = setupConsumerRepo({
		config: {
			packageScripts: {
				check: 'pnpm --filter {package} run check',
				testUnit: 'pnpm --filter {package} run test:unit',
			},
		},
	});

	writeFileSync(join(dir, '.gitignore'), 'node_modules\n'); // warn: run state not ignored
	mkdirSync(join(dir, 'packages/infra'), { recursive: true });
	writeFileSync(join(dir, 'packages/infra/package.json'), JSON.stringify({ name: '@acme/infra' })); // note: skips

	const checks = await runDoctor({ cwd: dir, probeHarness: passingProbe });
	const ranks = checks.map((check) => ({ pass: 0, note: 1, warn: 2, fail: 3 })[check.status]);

	assert.deepEqual([...ranks].sort((a, b) => a - b), ranks, `severity is non-decreasing: ${checks.map((c) => `${c.id}:${c.status}`).join(', ')}`);
	assert.ok(ranks.includes(1) && ranks.includes(2), 'fixture produced both a note and a warn');
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
	assert.match(checks.get('gitignore')?.detail ?? '', /not a git repository/, 'non-git repo is stated, not guessed at');
});
