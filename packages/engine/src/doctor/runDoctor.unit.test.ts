import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from '@jest/globals';
import { setupConsumerRepo } from '@tests/helpers/setupConsumerRepo';
import { runDoctor } from '@/doctor';

const passingProbe = async () => ({ exitCode: 0, stdout: '2.1.201 (Claude Code)\n', stderr: '' });

const byId = (checks: Awaited<ReturnType<typeof runDoctor>>) => new Map(checks.map((check) => [check.id, check]));

test('doctor passes a healthy consumer repo — gitignore judged by git, not by line-matching', async () => {
	const dir = setupConsumerRepo();

	// The bare-directory spelling (no trailing slash) that a real consumer
	// used and the old literal-line check false-warned on.
	writeFileSync(join(dir, '.gitignore'), '.lightsout\n');

	const checks = byId(await runDoctor({ cwd: dir, probeHarness: passingProbe }));

	expect(checks.get('config')?.status).toBe('pass');
	// a config with no harness key reports the default by name
	expect(checks.get('config')?.detail ?? '').toMatch(/harness claude-code/);
	// a config with no scoped gates is not announced as a monorepo
	expect(checks.get('config')?.detail ?? '').not.toMatch(/monorepo/);
	expect(checks.get('harness')?.status).toBe('pass');
	expect(checks.get('harness')?.detail ?? '').toMatch(/claude 2\.1\.201/);
	expect(checks.get('gitignore')?.status).toBe('pass');
	expect(checks.get('script-binaries')?.status).toBe('pass');

	// Checks with nothing to say emit no line at all — a single-package repo
	// has no scoped gates, no Jest config, and no testing-library to weigh in on.
	// a config without packageGates is not a monorepo to scope-check
	expect(checks.get('scoped-gates')).toBe(undefined);
	// no Jest config found means no mock-cleanup opinion
	expect(checks.get('jest-mocks')).toBe(undefined);
	// no testing-library dependency means no user-event nudge
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

test('doctor flags a broken harness binary with the probe output', async () => {
	const dir = setupConsumerRepo({ git: false });
	const checks = byId(
		await runDoctor({
			cwd: dir,
			probeHarness: async () => ({ exitCode: 1, stdout: '', stderr: 'spawn codex ENOENT' }),
		}),
	);

	expect(checks.get('harness')?.status).toBe('fail');
	expect(checks.get('harness')?.detail ?? '').toMatch(/ENOENT/);
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

	// a per-command harness whose binary is broken fails the harness check even
	// when the global binary is healthy
	expect(checks.get('harness')?.status).toBe('fail');
	expect(checks.get('harness')?.detail ?? '').toMatch(/codex/);
	// the fix names the broken binary
	expect(checks.get('harness')?.fix ?? '').toMatch(/codex/);
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

	expect(checks.get('harness')?.status).toBe('fail');
	expect(checks.get('harness')?.detail ?? '').toMatch(/claude not runnable: spawn claude EACCES/);
	// a binary that cannot even spawn gets the install fix, not the repair fix
	expect(checks.get('harness')?.fix ?? '').toMatch(/install/);
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

	expect(checks.get('harness')?.status).toBe('pass');
	// duplicate harness references collapse to one probe per binary
	expect([...probedBinaries].sort()).toStrictEqual(['claude', 'codex']);
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

	// a global harness replaces the default rather than adding to it
	expect(probedBinaries).toStrictEqual(['codex']);
	expect(checks.get('harness')?.status).toBe('pass');
	expect(checks.get('harness')?.detail ?? '').toMatch(/codex 0\.146\.0/);
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

	// every harness some command resolves to is probed
	expect([...probedBinaries].sort()).toStrictEqual(['claude', 'codex']);
	expect(checks.get('harness')?.status).toBe('pass');
});

test('doctor probes an unknown harness name as its own binary name — getDriver, not doctor, owns rejecting it', async () => {
	const dir = setupConsumerRepo({ git: false, config: { commands: { improve: { harness: 'my-harness' } } } });
	const checks = byId(
		await runDoctor({
			cwd: dir,
			probeHarness: async ({ binary }) => (binary === 'my-harness' ? { exitCode: 1, stdout: '', stderr: 'spawn my-harness ENOENT' } : passingProbe()),
		}),
	);

	expect(checks.get('harness')?.status).toBe('fail');
	// a harness name with no binary mapping is probed under its own name
	expect(checks.get('harness')?.detail ?? '').toMatch(/my-harness/);
});

test('doctor passes the harness check when every referenced binary probes green, naming each', async () => {
	const dir = setupConsumerRepo({ git: false, config: { commands: { improve: { harness: 'codex' } } } });
	const checks = byId(
		await runDoctor({
			cwd: dir,
			probeHarness: async ({ binary }) => ({ exitCode: 0, stdout: `${binary === 'claude' ? '2.1.201 (Claude Code)' : '0.128.0'}\n`, stderr: '' }),
		}),
	);

	expect(checks.get('harness')?.status).toBe('pass');
	expect(checks.get('harness')?.detail ?? '').toMatch(/claude 2\.1\.201/);
	expect(checks.get('harness')?.detail ?? '').toMatch(/codex 0\.128\.0/);
});

test('doctor warns on missing gitignore entries, scriptless packages, jest configs without mock cleanup, and stale generated paths', async () => {
	const dir = setupConsumerRepo({
		config: {
			generated: ['packages/api/src/gen/', 'packages/api/schema.gql'],
			packageGates: {
				check: 'pnpm --filter {package} run check',
				test: 'pnpm --filter {package} run test:unit',
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

	expect(checks.get('gitignore')?.status).toBe('warn');
	expect(checks.get('gitignore')?.fix ?? '').toMatch(/friction\.jsonl/);
	expect(checks.get('gitignore')?.fix ?? '').toMatch(/lock\.json/);
	// already-present entry not re-suggested
	expect((checks.get('gitignore')?.fix ?? '').includes('runs/')).toBeFalsy();

	// skips are a decision to surface, not a defect to nag about
	expect(checks.get('scoped-gates')?.status).toBe('note');
	expect(checks.get('scoped-gates')?.detail ?? '').toMatch(/infra \(check, test:unit\)/);
	expect(checks.get('scoped-gates')?.detail ?? '').toMatch(/typo'd script name looks identical/);

	expect(checks.get('jest-mocks')?.status).toBe('warn');
	expect(checks.get('jest-mocks')?.detail ?? '').toMatch(/api.*jest\.config\.js lacks restoreMocks/);

	expect(checks.get('generated')?.status).toBe('warn');
	expect(checks.get('generated')?.detail ?? '').toMatch(/schema\.gql/);
	// existing generated path not flagged
	expect((checks.get('generated')?.detail ?? '').includes('src/gen')).toBeFalsy();
});

test('doctor finds jest configs under the plural tests/ directory, not just test/', async () => {
	const dir = setupConsumerRepo({ git: false });

	mkdirSync(join(dir, 'tests/config'), { recursive: true });
	writeFileSync(join(dir, 'tests/config/jest.config.cjs'), 'module.exports = { clearMocks: true };\n');

	const checks = byId(await runDoctor({ cwd: dir, probeHarness: passingProbe }));

	// a warn verdict is what proves the config was discovered AND read — the
	// engine's own repo spells this directory `tests`, and isTestFile already
	// accepts both spellings, so scanning only `test/` left it in a blind spot
	expect(checks.get('jest-mocks')?.status).toBe('warn');
	expect(checks.get('jest-mocks')?.detail ?? '').toMatch(/tests\/config\/jest\.config\.cjs lacks restoreMocks/);
});

test('doctor notes packages with @testing-library/react but no user-event — and stays silent for packages with both or neither', async () => {
	const dir = setupConsumerRepo({
		git: false,
		config: {
			packageGates: { check: 'pnpm --filter {package} run check', test: 'pnpm --filter {package} run test:unit' },
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

	// a recommendation, not a defect
	expect(checks.get('user-event')?.status).toBe('note');
	expect(checks.get('user-event')?.detail ?? '').toMatch(/web-app/);
	// package already on user-event not flagged
	expect((checks.get('user-event')?.detail ?? '').includes('widget')).toBeFalsy();
	// package without testing-library not flagged
	expect((checks.get('user-event')?.detail ?? '').includes('api')).toBeFalsy();
});

test('doctor lint-rules: flags disabled mechanical rules, passes enforced ones, notes a missing linter, and respects standardsPackages:false', async () => {
	// Disabled + missing rules → note naming them
	const flagged = setupConsumerRepo({ git: false });

	writeFileSync(join(flagged, 'biome.json'), '{"linter":{"rules":{"style":{"useImportType":"off"}}}}');

	const flaggedChecks = byId(await runDoctor({ cwd: flagged, probeHarness: passingProbe }));

	expect(flaggedChecks.get('lint-rules')?.status).toBe('note');
	expect(flaggedChecks.get('lint-rules')?.detail ?? '').toMatch(/useImportType, noExplicitAny missing or disabled/);

	// Both rules on → pass
	const clean = setupConsumerRepo({ git: false });

	writeFileSync(join(clean, 'biome.json'), '{"linter":{"rules":{"style":{"useImportType":"error"},"suspicious":{"noExplicitAny":"error"}}}}');

	const cleanChecks = byId(await runDoctor({ cwd: clean, probeHarness: passingProbe }));

	expect(cleanChecks.get('lint-rules')?.status).toBe('pass');

	// No linter at all → note
	const bare = setupConsumerRepo({ git: false });
	const bareChecks = byId(await runDoctor({ cwd: bare, probeHarness: passingProbe }));

	expect(bareChecks.get('lint-rules')?.status).toBe('note');
	expect(bareChecks.get('lint-rules')?.detail ?? '').toMatch(/no linter config found/);

	// standardsPackages: false = the consumer opted out — no check at all
	const yolo = setupConsumerRepo({ git: false, config: { standardsPackages: false } });
	const yoloChecks = byId(await runDoctor({ cwd: yolo, probeHarness: passingProbe }));

	// opting out of standards opts out of the lint nudge
	expect(yoloChecks.get('lint-rules')).toBe(undefined);
});

test('doctor lint-rules judges an eslint config by the eslint rule names, not biome’s', async () => {
	// One rule turned off, the other never mentioned → note naming both.
	const flagged = setupConsumerRepo({ git: false });

	writeFileSync(join(flagged, 'eslint.config.mjs'), 'export default [{ rules: { "@typescript-eslint/consistent-type-imports": "off" } }];\n');

	const flaggedChecks = byId(await runDoctor({ cwd: flagged, probeHarness: passingProbe }));

	expect(flaggedChecks.get('lint-rules')?.status).toBe('note');
	expect(flaggedChecks.get('lint-rules')?.detail ?? '').toMatch(/eslint\.config\.mjs — consistent-type-imports, no-explicit-any missing or disabled/);

	// A legacy .eslintrc with both rules on → pass, counted as one config.
	const clean = setupConsumerRepo({ git: false });

	writeFileSync(join(clean, '.eslintrc.json'), '{"rules":{"@typescript-eslint/consistent-type-imports":"error","@typescript-eslint/no-explicit-any":"error"}}');

	const cleanChecks = byId(await runDoctor({ cwd: clean, probeHarness: passingProbe }));

	expect(cleanChecks.get('lint-rules')?.status).toBe('pass');
	expect(cleanChecks.get('lint-rules')?.detail ?? '').toMatch(/1 lint config/);
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

test('doctor skips an unparseable package.json and keeps auditing the rest', async () => {
	const dir = setupConsumerRepo({
		git: false,
		config: {
			packageGates: { check: 'pnpm --filter {package} run check', test: 'pnpm --filter {package} run test:unit' },
		},
	});

	writeFileSync(join(dir, 'package.json'), '{ "name": "root",\n'); // truncated mid-edit

	mkdirSync(join(dir, 'packages/web-app'), { recursive: true });
	writeFileSync(
		join(dir, 'packages/web-app/package.json'),
		JSON.stringify({ name: '@acme/web-app', scripts: { check: 'x' }, devDependencies: { '@testing-library/react': '^16.0.0' } }),
	);

	const checks = byId(await runDoctor({ cwd: dir, probeHarness: passingProbe }));

	// a manifest that will not parse is skipped, not fatal
	expect(checks.get('user-event')?.status).toBe('note');
	expect(checks.get('user-event')?.detail ?? '').toMatch(/web-app/);
	// the unparseable manifest yields no finding of its own
	expect((checks.get('user-event')?.detail ?? '').includes('root')).toBeFalsy();
});

test('doctor skips a package.json whose dependency fields have the wrong shape', async () => {
	const dir = setupConsumerRepo({
		git: false,
		config: {
			packageGates: { check: 'pnpm --filter {package} run check', test: 'pnpm --filter {package} run test:unit' },
		},
	});

	writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'root', devDependencies: ['@testing-library/react'] }));

	mkdirSync(join(dir, 'packages/web-app'), { recursive: true });
	writeFileSync(
		join(dir, 'packages/web-app/package.json'),
		JSON.stringify({ name: '@acme/web-app', scripts: { check: 'x' }, devDependencies: { '@testing-library/react': '^16.0.0' } }),
	);

	const checks = byId(await runDoctor({ cwd: dir, probeHarness: passingProbe }));

	// a manifest that fails the dependency schema is skipped, not read anyway
	expect(checks.get('user-event')?.status).toBe('note');
	expect(checks.get('user-event')?.detail ?? '').toMatch(/web-app/);
	// the malformed dependency list produces no finding of its own
	expect((checks.get('user-event')?.detail ?? '').includes('root')).toBeFalsy();
});

test('doctor probes the binaries of scoped gate commands too, not just the root gates', async () => {
	const dir = setupConsumerRepo({
		git: false,
		config: {
			packageGates: {
				check: 'definitely-not-a-real-binary-xyz --filter {package} run check',
				test: 'definitely-not-a-real-binary-xyz --filter {package} run test:unit',
			},
		},
	});

	const checks = byId(await runDoctor({ cwd: dir, probeHarness: passingProbe }));

	expect(checks.get('script-binaries')?.status).toBe('fail');
	expect(checks.get('script-binaries')?.detail ?? '').toMatch(/definitely-not-a-real-binary-xyz/);
	expect(checks.get('script-binaries')?.fix ?? '').toMatch(/install/);
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

	// severity is non-decreasing: ${checks.map((c) =>
	// `${c.id}:${c.status}`).join(', ')}
	expect([...ranks].sort((a, b) => a - b)).toStrictEqual(ranks);
	// fixture produced both a note and a warn
	expect(ranks.includes(1) && ranks.includes(2)).toBeTruthy();
});

test('doctor passes the generated check when every configured path exists, and emits no check when none are configured', async () => {
	const configured = setupConsumerRepo({ git: false, config: { generated: ['src/gen/', 'schema.gql'] } });

	mkdirSync(join(configured, 'src/gen'), { recursive: true });
	writeFileSync(join(configured, 'schema.gql'), 'type Query { one: Int }\n');

	const configuredChecks = byId(await runDoctor({ cwd: configured, probeHarness: passingProbe }));

	expect(configuredChecks.get('generated')?.status).toBe('pass');
	// a directory prefix and a plain file both count as present
	expect(configuredChecks.get('generated')?.detail ?? '').toMatch(/2 generated path\(s\) exist/);
	// a pass carries no fix
	expect(configuredChecks.get('generated')?.fix).toBe(undefined);

	const bare = setupConsumerRepo({ git: false });
	const bareChecks = byId(await runDoctor({ cwd: bare, probeHarness: passingProbe }));

	// no `generated` key means no generated check at all, not an empty pass
	expect(bareChecks.get('generated')).toBe(undefined);
});

test('doctor reports the coverage summary only for repos that measure coverage', async () => {
	const measuring = setupConsumerRepo({ git: false, scripts: { testCoverage: 'pnpm test:coverage' } });

	mkdirSync(join(measuring, 'coverage'), { recursive: true });
	writeFileSync(join(measuring, 'coverage/coverage-summary.json'), '{}');

	const measuringChecks = byId(await runDoctor({ cwd: measuring, probeHarness: passingProbe }));

	// the summary is what `lightsout test-coverage-to-threshold` reads per-file numbers from
	expect(measuringChecks.get('coverage-summary')?.status).toBe('pass');

	const optedOut = setupConsumerRepo({ git: false });
	const optedOutChecks = byId(await runDoctor({ cwd: optedOut, probeHarness: passingProbe }));

	// a repo with no coverage command has nothing to report a summary for
	expect(optedOutChecks.get('coverage-summary')).toBe(undefined);
});

test('doctor checks the coverage summary of every package a monorepo measures, not only the root', async () => {
	const dir = setupConsumerRepo({
		git: false,
		config: {
			packageGates: {
				check: 'pnpm --filter {package} run check',
				test: 'pnpm --filter {package} run test:unit',
				testCoverage: 'pnpm --filter {package} run test:coverage',
			},
		},
	});
	const manifestScripts = { check: 'x', 'test:unit': 'x', 'test:coverage': 'x' };

	mkdirSync(join(dir, 'packages/api/coverage'), { recursive: true });
	writeFileSync(join(dir, 'packages/api/package.json'), JSON.stringify({ name: '@acme/api', scripts: manifestScripts }));
	writeFileSync(join(dir, 'packages/api/coverage/coverage-summary.json'), '{}');

	mkdirSync(join(dir, 'packages/web'), { recursive: true });
	writeFileSync(join(dir, 'packages/web/package.json'), JSON.stringify({ name: '@acme/web', scripts: manifestScripts }));

	const checks = byId(await runDoctor({ cwd: dir, probeHarness: passingProbe }));

	// the packages resolved once for the scoped gates are the scopes the coverage check reads
	expect(checks.get('coverage-summary')?.status).toBe('warn');
	expect(checks.get('coverage-summary')?.detail).toBe('not found: web: coverage/coverage-summary.json');
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

	expect(checks.get('jest-mocks')?.status).toBe('pass');
	expect(checks.get('script-binaries')?.status).toBe('fail');
	expect(checks.get('script-binaries')?.detail ?? '').toMatch(/definitely-not-a-real-binary-xyz/);
	// non-git repo is stated, not guessed at
	expect(checks.get('gitignore')?.detail ?? '').toMatch(/not a git repository/);
});
