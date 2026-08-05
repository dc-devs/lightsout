import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { runDoctor } from '@/doctor';
import { setupConsumerRepo } from '@tests/helpers/setupConsumerRepo';

const passingProbe = async () => ({ exitCode: 0, stdout: '2.1.201 (Claude Code)\n', stderr: '' });

const byId = (checks: Awaited<ReturnType<typeof runDoctor>>) => new Map(checks.map((check) => [check.id, check]));

test('doctor passes a healthy consumer repo — gitignore judged by git, not by line-matching', async () => {
	const dir = setupConsumerRepo();

	// The bare-directory spelling (no trailing slash) that a real consumer
	// used and the old literal-line check false-warned on.
	writeFileSync(join(dir, '.gitignore'), '.lightsout\n');

	const checks = byId(await runDoctor({ cwd: dir, probeHarness: passingProbe }));

	assert.equal(checks.get('config')?.status, 'pass');
	assert.match(checks.get('config')?.detail ?? '', /harness claude-code/, 'a config with no harness key reports the default by name');
	assert.equal(checks.get('harness')?.status, 'pass');
	assert.match(checks.get('harness')?.detail ?? '', /claude 2\.1\.201/);
	assert.equal(checks.get('gitignore')?.status, 'pass', checks.get('gitignore')?.detail);
	assert.equal(checks.get('script-binaries')?.status, 'pass', checks.get('script-binaries')?.detail);

	// Checks with nothing to say emit no line at all — a single-package repo
	// has no scoped gates, no Jest config, and no testing-library to weigh in on.
	assert.equal(checks.get('scoped-gates'), undefined, 'a config without packageScripts is not a monorepo to scope-check');
	assert.equal(checks.get('jest-mocks'), undefined, 'no Jest config found means no mock-cleanup opinion');
	assert.equal(checks.get('user-event'), undefined, 'no testing-library dependency means no user-event nudge');
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

test('doctor probes every harness binary the commands block references and names the broken one', async () => {
	const dir = setupConsumerRepo({ git: false, config: { commands: { improve: { harness: 'codex' } } } });
	const checks = byId(
		await runDoctor({
			cwd: dir,
			probeHarness: async ({ binary }) =>
				binary === 'claude' ? { exitCode: 0, stdout: '2.1.201 (Claude Code)\n', stderr: '' } : { exitCode: 1, stdout: '', stderr: `spawn ${binary} ENOENT` },
		}),
	);

	assert.equal(checks.get('harness')?.status, 'fail', 'a per-command harness whose binary is broken fails the harness check even when the global binary is healthy');
	assert.match(checks.get('harness')?.detail ?? '', /codex/);
	assert.match(checks.get('harness')?.fix ?? '', /codex/, 'the fix names the broken binary');
});

test('doctor reports a harness binary whose probe throws as not runnable, with an install fix', async () => {
	const dir = setupConsumerRepo({ git: false });
	const checks = byId(
		await runDoctor({
			cwd: dir,
			probeHarness: async () => {
				throw new Error('spawn claude EACCES');
			},
		}),
	);

	assert.equal(checks.get('harness')?.status, 'fail');
	assert.match(checks.get('harness')?.detail ?? '', /claude not runnable: spawn claude EACCES/);
	assert.match(checks.get('harness')?.fix ?? '', /install/, 'a binary that cannot even spawn gets the install fix, not the repair fix');
});

test('doctor probes each referenced binary once, even when several commands name the same harness', async () => {
	const dir = setupConsumerRepo({
		git: false,
		config: { commands: { implement: { harness: 'codex' }, refactor: { harness: 'codex' }, improve: { harness: 'claude-code' } } },
	});
	const probedBinaries: string[] = [];
	const checks = byId(
		await runDoctor({
			cwd: dir,
			probeHarness: async ({ binary }) => {
				probedBinaries.push(binary);

				return { exitCode: 0, stdout: '1.0.0\n', stderr: '' };
			},
		}),
	);

	assert.equal(checks.get('harness')?.status, 'pass');
	assert.deepEqual([...probedBinaries].sort(), ['claude', 'codex'], 'duplicate harness references collapse to one probe per binary');
});

test('doctor probes the binary the global harness key names, not the claude-code default', async () => {
	const dir = setupConsumerRepo({ git: false, config: { harness: 'codex' } });
	const probedBinaries: string[] = [];
	const checks = byId(
		await runDoctor({
			cwd: dir,
			probeHarness: async ({ binary }) => {
				probedBinaries.push(binary);

				return { exitCode: 0, stdout: '0.146.0\n', stderr: '' };
			},
		}),
	);

	assert.deepEqual(probedBinaries, ['codex'], 'a global harness replaces the default rather than adding to it');
	assert.equal(checks.get('harness')?.status, 'pass');
	assert.match(checks.get('harness')?.detail ?? '', /codex 0\.146\.0/);
});

test('doctor names the configured global harness in the config check detail', async () => {
	const dir = setupConsumerRepo({ git: false, config: { harness: 'codex' } });
	const checks = byId(await runDoctor({ cwd: dir, probeHarness: passingProbe }));

	assert.equal(checks.get('config')?.status, 'pass');
	assert.match(checks.get('config')?.detail ?? '', /harness codex/);
});

test('doctor probes both the global harness and a command that overrides it', async () => {
	const dir = setupConsumerRepo({ git: false, config: { harness: 'codex', commands: { plan: { harness: 'claude-code' } } } });
	const probedBinaries: string[] = [];
	const checks = byId(
		await runDoctor({
			cwd: dir,
			probeHarness: async ({ binary }) => {
				probedBinaries.push(binary);

				return { exitCode: 0, stdout: '1.0.0\n', stderr: '' };
			},
		}),
	);

	assert.deepEqual([...probedBinaries].sort(), ['claude', 'codex'], 'every harness some command resolves to is probed');
	assert.equal(checks.get('harness')?.status, 'pass');
});

test('doctor probes an unknown harness name as its own binary name — getDriver, not doctor, owns rejecting it', async () => {
	const dir = setupConsumerRepo({ git: false, config: { commands: { improve: { harness: 'my-harness' } } } });
	const checks = byId(
		await runDoctor({
			cwd: dir,
			probeHarness: async ({ binary }) => (binary === 'my-harness' ? { exitCode: 1, stdout: '', stderr: 'spawn my-harness ENOENT' } : passingProbe()),
		}),
	);

	assert.equal(checks.get('harness')?.status, 'fail');
	assert.match(checks.get('harness')?.detail ?? '', /my-harness/, 'a harness name with no binary mapping is probed under its own name');
});

test('doctor passes the harness check when every referenced binary probes green, naming each', async () => {
	const dir = setupConsumerRepo({ git: false, config: { commands: { improve: { harness: 'codex' } } } });
	const checks = byId(
		await runDoctor({
			cwd: dir,
			probeHarness: async ({ binary }) => ({ exitCode: 0, stdout: `${binary === 'claude' ? '2.1.201 (Claude Code)' : '0.128.0'}\n`, stderr: '' }),
		}),
	);

	assert.equal(checks.get('harness')?.status, 'pass');
	assert.match(checks.get('harness')?.detail ?? '', /claude 2\.1\.201/);
	assert.match(checks.get('harness')?.detail ?? '', /codex 0\.128\.0/);
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

test('doctor lint-rules judges an eslint config by the eslint rule names, not biome’s', async () => {
	// One rule turned off, the other never mentioned → note naming both.
	const flagged = setupConsumerRepo({ git: false });

	writeFileSync(join(flagged, 'eslint.config.mjs'), 'export default [{ rules: { "@typescript-eslint/consistent-type-imports": "off" } }];\n');

	const flaggedChecks = byId(await runDoctor({ cwd: flagged, probeHarness: passingProbe }));

	assert.equal(flaggedChecks.get('lint-rules')?.status, 'note');
	assert.match(flaggedChecks.get('lint-rules')?.detail ?? '', /eslint\.config\.mjs — consistent-type-imports, no-explicit-any missing or disabled/);

	// A legacy .eslintrc with both rules on → pass, counted as one config.
	const clean = setupConsumerRepo({ git: false });

	writeFileSync(
		join(clean, '.eslintrc.json'),
		'{"rules":{"@typescript-eslint/consistent-type-imports":"error","@typescript-eslint/no-explicit-any":"error"}}',
	);

	const cleanChecks = byId(await runDoctor({ cwd: clean, probeHarness: passingProbe }));

	assert.equal(cleanChecks.get('lint-rules')?.status, 'pass', cleanChecks.get('lint-rules')?.detail);
	assert.match(cleanChecks.get('lint-rules')?.detail ?? '', /1 lint config/);
});

test('doctor passes scoped-gates when every package defines every scoped gate script', async () => {
	const dir = setupConsumerRepo({
		git: false,
		config: {
			packageScripts: { check: 'pnpm --filter {package} run check', testUnit: 'pnpm --filter {package} run test:unit' },
		},
	});

	mkdirSync(join(dir, 'packages/api'), { recursive: true });
	writeFileSync(join(dir, 'packages/api/package.json'), JSON.stringify({ name: '@acme/api', scripts: { check: 'x', 'test:unit': 'x' } }));

	const checks = byId(await runDoctor({ cwd: dir, probeHarness: passingProbe }));

	assert.equal(checks.get('scoped-gates')?.status, 'pass');
	assert.match(checks.get('scoped-gates')?.detail ?? '', /every package defines every scoped gate/);
});

test('doctor treats only manifest-bearing, non-dot directories as packages', async () => {
	const dir = setupConsumerRepo({
		git: false,
		config: {
			packageScripts: { check: 'pnpm --filter {package} run check', testUnit: 'pnpm --filter {package} run test:unit' },
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

	assert.equal(checks.get('scoped-gates')?.status, 'pass', 'a skipped directory is never reported as a package missing its gate script');
	assert.equal(checks.get('jest-mocks'), undefined, 'Jest configs under a non-package directory are never read');
});

test('doctor skips an unparseable package.json and keeps auditing the rest', async () => {
	const dir = setupConsumerRepo({
		git: false,
		config: {
			packageScripts: { check: 'pnpm --filter {package} run check', testUnit: 'pnpm --filter {package} run test:unit' },
		},
	});

	writeFileSync(join(dir, 'package.json'), '{ "name": "root",\n'); // truncated mid-edit

	mkdirSync(join(dir, 'packages/web-app'), { recursive: true });
	writeFileSync(
		join(dir, 'packages/web-app/package.json'),
		JSON.stringify({ name: '@acme/web-app', scripts: { check: 'x' }, devDependencies: { '@testing-library/react': '^16.0.0' } }),
	);

	const checks = byId(await runDoctor({ cwd: dir, probeHarness: passingProbe }));

	assert.equal(checks.get('user-event')?.status, 'note', 'a manifest that will not parse is skipped, not fatal');
	assert.match(checks.get('user-event')?.detail ?? '', /web-app/);
	assert.ok(!(checks.get('user-event')?.detail ?? '').includes('root'), 'the unparseable manifest yields no finding of its own');
});

test('doctor skips a package.json whose dependency fields have the wrong shape', async () => {
	const dir = setupConsumerRepo({
		git: false,
		config: {
			packageScripts: { check: 'pnpm --filter {package} run check', testUnit: 'pnpm --filter {package} run test:unit' },
		},
	});

	writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'root', devDependencies: ['@testing-library/react'] }));

	mkdirSync(join(dir, 'packages/web-app'), { recursive: true });
	writeFileSync(
		join(dir, 'packages/web-app/package.json'),
		JSON.stringify({ name: '@acme/web-app', scripts: { check: 'x' }, devDependencies: { '@testing-library/react': '^16.0.0' } }),
	);

	const checks = byId(await runDoctor({ cwd: dir, probeHarness: passingProbe }));

	assert.equal(checks.get('user-event')?.status, 'note', 'a manifest that fails the dependency schema is skipped, not read anyway');
	assert.match(checks.get('user-event')?.detail ?? '', /web-app/);
	assert.ok(!(checks.get('user-event')?.detail ?? '').includes('root'), 'the malformed dependency list produces no finding of its own');
});

test('doctor probes the binaries of scoped gate commands too, not just the root scripts', async () => {
	const dir = setupConsumerRepo({
		git: false,
		config: {
			packageScripts: {
				check: 'definitely-not-a-real-binary-xyz --filter {package} run check',
				testUnit: 'definitely-not-a-real-binary-xyz --filter {package} run test:unit',
			},
		},
	});

	const checks = byId(await runDoctor({ cwd: dir, probeHarness: passingProbe }));

	assert.equal(checks.get('script-binaries')?.status, 'fail');
	assert.match(checks.get('script-binaries')?.detail ?? '', /definitely-not-a-real-binary-xyz/);
	assert.match(checks.get('script-binaries')?.fix ?? '', /install/);
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

test('doctor passes the generated check when every configured path exists, and emits no check when none are configured', async () => {
	const configured = setupConsumerRepo({ git: false, config: { generated: ['src/gen/', 'schema.gql'] } });

	mkdirSync(join(configured, 'src/gen'), { recursive: true });
	writeFileSync(join(configured, 'schema.gql'), 'type Query { one: Int }\n');

	const configuredChecks = byId(await runDoctor({ cwd: configured, probeHarness: passingProbe }));

	assert.equal(configuredChecks.get('generated')?.status, 'pass', configuredChecks.get('generated')?.detail);
	assert.match(configuredChecks.get('generated')?.detail ?? '', /2 generated path\(s\) exist/, 'a directory prefix and a plain file both count as present');
	assert.equal(configuredChecks.get('generated')?.fix, undefined, 'a pass carries no fix');

	const bare = setupConsumerRepo({ git: false });
	const bareChecks = byId(await runDoctor({ cwd: bare, probeHarness: passingProbe }));

	assert.equal(bareChecks.get('generated'), undefined, 'no `generated` key means no generated check at all, not an empty pass');
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
