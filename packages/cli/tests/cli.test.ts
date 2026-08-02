import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

// The CLI has no in-process seam (process.exit + hard-wired getDriver), so
// characterization runs it as a subprocess and pins EXACT stdout/stderr/exit.
// The bundle under test is produced by the root `test` script from CURRENT
// source (.test-dist/cli-under-test.mjs), never the committed plugin bundle.
const CLI = join(process.cwd(), '.test-dist', 'cli-under-test.mjs');

// Byte-exact copy of the CLI's `usage` constant. console.error(usage) appends
// one newline; the constant already ends in a newline, so error output ends
// with two. Pinning this whole block is the point of characterization: if a
// refactor changes it, this suite goes red and the refactor is wrong. (A
// FEATURE adding a command updates this pin deliberately — updated 2026-07-09
// for `plan verify-facts` replacing `plan explore`, 2026-07-14 for `plan
// lint`, 2026-07-23 for the verify-facts `--notes` flag, 2026-08-01 for the
// removal of `verify`.)
const usage = `lightsout — deterministic engine for coding agents

usage:
  lightsout implement --plan <path> [--overview <path>] [--packages <a,b>] [--cwd <path>] [--skip-refactor]
  lightsout resume --run <id> [--cwd <path>] [--skip-refactor]
  lightsout status [--cwd <path>]
  lightsout doctor [--cwd <path>]
  lightsout scan [--cwd <path>] [--path <subdir>] [--all] [--baseline]
  lightsout refactor [--cwd <path>] [--path <subdir>] [--all] [--max-batches <n>]
  lightsout refactor --run <id> [--cwd <path>]        (resume a parked refactor run)
  lightsout plan verify-facts --name <n> [--notes <path>] [--cwd <path>]
  lightsout plan draft --name <n> [--scope single|phased] [--plans <dir>] [--cwd <path>]
  lightsout plan lint --name <n> [--plans <dir>] [--cwd <path>]
  lightsout plan dedup --name <n> [--plans <dir>] [--cwd <path>]
  lightsout plan grade --name <n> [--plans <dir>] [--cwd <path>]
  lightsout friction [--cwd <path>]
  lightsout improve --engine <lightsout-repo-path> [--cwd <path>]
`;

const usageErr = `${usage}\n`;

const runCli = ({ args }: { args: string[] }) =>
	new Promise<{ stdout: string; stderr: string; code: number | null }>((resolve, reject) => {
		const child = spawn(process.execPath, [CLI, ...args]);

		let stdout = '';
		let stderr = '';

		child.stdout.on('data', (chunk) => {
			stdout += chunk;
		});
		child.stderr.on('data', (chunk) => {
			stderr += chunk;
		});
		child.on('error', reject);
		child.on('close', (code) => resolve({ stdout, stderr, code }));
	});

const freshCwd = async () => mkdtemp(join(tmpdir(), 'lightsout-cli-'));

// A consumer repo whose authored facts claim one real and one missing path,
// plus one real and one missing script — the mixed case verify-facts must
// warn about while still exiting 0.
const seedVerifyFactsFixture = async () => {
	const cwd = await freshCwd();
	const workspaceDir = join(cwd, '.lightsout', 'plans', 'demo');
	const factsPath = join(workspaceDir, 'facts.json');

	await mkdir(join(cwd, 'src'), { recursive: true });
	await mkdir(workspaceDir, { recursive: true });
	await writeFile(join(cwd, 'package.json'), JSON.stringify({ name: 'consumer', scripts: { check: 'tsc --noEmit' } }), 'utf8');
	await writeFile(join(cwd, 'src', 'real.ts'), 'export const real = true;\n', 'utf8');
	await writeFile(
		factsPath,
		JSON.stringify({
			request: 'add a widget',
			areas: [
				{
					area: 'cli',
					affectedPackages: [],
					filesToModify: [
						{ path: 'src/real.ts', role: 'the file that exists' },
						{ path: 'src/missing.ts', role: 'the file that does not' },
					],
					patternsToMirror: [],
					integrationPoints: [],
					scripts: [
						{ key: 'check', command: 'tsc --noEmit' },
						{ key: 'nope', command: 'does not exist' },
					],
					namingConvention: 'camelCase',
				},
			],
		}),
		'utf8',
	);

	return { cwd, factsPath };
};

test('cli: no args prints usage to stderr and exits 0', async () => {
	const { stdout, stderr, code } = await runCli({ args: [] });

	assert.equal(stdout, '');
	assert.equal(stderr, usageErr);
	assert.equal(code, 0);
});

test('cli: help prints usage to stderr and exits 0', async () => {
	const { stdout, stderr, code } = await runCli({ args: ['help'] });

	assert.equal(stdout, '');
	assert.equal(stderr, usageErr);
	assert.equal(code, 0);
});

test('cli: an unknown command prints usage to stderr and exits 1', async () => {
	const { stdout, stderr, code } = await runCli({ args: ['nonsense'] });

	assert.equal(stdout, '');
	assert.equal(stderr, usageErr);
	assert.equal(code, 1);
});

test('cli: status in a fresh dir reports no runs and exits 0', async () => {
	const cwd = await freshCwd();
	const { stdout, stderr, code } = await runCli({ args: ['status', '--cwd', cwd] });

	assert.equal(stdout, 'no runs found\n');
	assert.equal(stderr, '');
	assert.equal(code, 0);
});

test('cli: friction in a fresh dir reports nothing recorded and exits 0', async () => {
	const cwd = await freshCwd();
	const { stdout, stderr, code } = await runCli({ args: ['friction', '--cwd', cwd] });

	assert.equal(stdout, 'no friction recorded\n');
	assert.equal(stderr, '');
	assert.equal(code, 0);
});

test('cli: verify (removed command) prints usage to stderr and exits 1', async () => {
	const cwd = await freshCwd();
	const { stdout, stderr, code } = await runCli({ args: ['verify', '--cwd', cwd] });

	assert.equal(stdout, '');
	assert.equal(stderr, usageErr);
	assert.equal(code, 1);
});

test('cli: implement without --plan prints usage to stderr and exits 1', async () => {
	const cwd = await freshCwd();
	const { stdout, stderr, code } = await runCli({ args: ['implement', '--cwd', cwd] });

	assert.equal(stdout, '');
	assert.equal(stderr, usageErr);
	assert.equal(code, 1);
});

test('cli: plan explore (removed subcommand) prints usage to stderr and exits 1', async () => {
	const cwd = await freshCwd();
	const { stdout, stderr, code } = await runCli({ args: ['plan', 'explore', '--name', 'demo', '--cwd', cwd] });

	assert.equal(stdout, '');
	assert.equal(stderr, usageErr);
	assert.equal(code, 1);
});

test('cli: plan verify-facts without --name prints usage to stderr and exits 1', async () => {
	const cwd = await freshCwd();
	const { stdout, stderr, code } = await runCli({ args: ['plan', 'verify-facts', '--cwd', cwd] });

	assert.equal(stdout, '');
	assert.equal(stderr, usageErr);
	assert.equal(code, 1);
});

test('cli: plan verify-facts without an authored facts.json reports the error and exits 1', async () => {
	const cwd = await freshCwd();
	const { stdout, stderr, code } = await runCli({ args: ['plan', 'verify-facts', '--name', 'demo', '--cwd', cwd] });

	assert.equal(stdout, '');
	assert.match(stderr, /no authored facts for plan demo/);
	assert.equal(code, 1);
});

test('cli: plan verify-facts with an unparsable facts.json reports the error and exits 1', async () => {
	const cwd = await freshCwd();
	const workspaceDir = join(cwd, '.lightsout', 'plans', 'demo');
	await mkdir(workspaceDir, { recursive: true });
	await writeFile(join(workspaceDir, 'facts.json'), '{"request": 42}', 'utf8');

	const { stdout, stderr, code } = await runCli({ args: ['plan', 'verify-facts', '--name', 'demo', '--cwd', cwd] });

	assert.equal(stdout, '');
	assert.notEqual(stderr, '');
	assert.equal(code, 1);
});

// A structurally clean plan whose paths resolve against seedPlanLintFixture:
// the modify/mirror path exists, the create path does not, and `true` is a raw
// command (no package-manager prefix), so ScriptExists never fires and the
// fixture needs no lightsout.config.json.
const cleanPlanBody = `# Clean Plan

## Context

A tiny clean plan for the structural lint.

## Global Constraints

- None

## Prerequisites

- None

## Files to Create

### \`src/new-thing.ts\`

A new module exporting \`newThing\`.

## Files to Modify

### \`src/index.js\`

Re-export \`newThing\`.

## Patterns to Mirror

- \`src/index.js\` — mirror its single-export shape.

## Prior Art

- \`newThing\` — searched newThing/new-thing, found none (new).

## Scope Boundaries

**Do:**
- Add \`newThing\`.

**Do NOT:**
- Touch anything else.

## Verification

- \`true\` — types clean

## What Next Plan Expects

None — standalone plan.
`;

// A consumer repo with a committed plan deliverable and deliberately NO
// lightsout.config.json: `plan lint` is deterministic and must route before
// resolveConfigAndDriver, so it works where a config-dependent command would
// fail. `plansDir` defaults to .claude/plans unless the caller relocates it.
const seedPlanLintFixture = async ({ body, plansSubdir = join('.claude', 'plans') }: { body: string; plansSubdir?: string }) => {
	const cwd = await freshCwd();
	const plansDir = join(cwd, plansSubdir);

	await mkdir(join(cwd, 'src'), { recursive: true });
	await mkdir(plansDir, { recursive: true });
	await writeFile(join(cwd, 'src', 'index.js'), 'export const one = 1;\n', 'utf8');
	await writeFile(join(plansDir, 'demo.md'), body, 'utf8');

	return { cwd, plansDir };
};

test('cli: plan lint without --name prints usage to stderr and exits 1', async () => {
	const cwd = await freshCwd();

	const { stdout, stderr, code } = await runCli({ args: ['plan', 'lint', '--cwd', cwd] });

	assert.equal(stdout, '');
	assert.equal(stderr, usageErr);
	assert.equal(code, 1);
});

test('cli: plan lint on a clean plan reports clean and exits 0', async () => {
	const { cwd } = await seedPlanLintFixture({ body: cleanPlanBody });

	const { stdout, stderr, code } = await runCli({ args: ['plan', 'lint', '--name', 'demo', '--cwd', cwd] });

	assert.equal(stderr, '');
	assert.match(stdout, /plan lint demo: 0 structural finding\(s\) across 1 file\(s\)/);
	assert.match(stdout, /plan lint demo — clean \(1 file\(s\)\)/);
	assert.ok(!stdout.includes('⚠'), 'a clean plan prints no finding lines');
	assert.equal(code, 0);
});

test('cli: plan lint on a plan with a placeholder prints the finding and exits 1', async () => {
	const { cwd } = await seedPlanLintFixture({ body: cleanPlanBody.replace('A new module exporting', 'TBD — a new module exporting') });

	const { stdout, stderr, code } = await runCli({ args: ['plan', 'lint', '--name', 'demo', '--cwd', cwd] });

	assert.equal(stderr, '');
	assert.match(stdout, /plan lint demo — 1 structural finding\(s\) \(1 file\(s\)\)/);
	assert.match(stdout, /⚠ \[no-placeholders\] demo\.md:\d+ — unresolved placeholder 'TBD' present/);
	assert.match(stdout, /fix: resolve 'TBD'/);
	assert.equal(code, 1);
});

test('cli: plan lint reads the plan deliverable from --plans and exits 0 when clean', async () => {
	const { cwd, plansDir } = await seedPlanLintFixture({ body: cleanPlanBody, plansSubdir: 'elsewhere' });

	const { stdout, stderr, code } = await runCli({ args: ['plan', 'lint', '--name', 'demo', '--plans', plansDir, '--cwd', cwd] });

	assert.equal(stderr, '');
	assert.match(stdout, /plan lint demo — clean \(1 file\(s\)\)/);
	assert.equal(code, 0);
});

test('cli: plan lint without a plan deliverable reports the error and exits 1', async () => {
	const cwd = await freshCwd();

	const { stdout, stderr, code } = await runCli({ args: ['plan', 'lint', '--name', 'ghost', '--cwd', cwd] });

	assert.equal(stdout, '');
	assert.match(stderr, /no plan found for 'ghost'/);
	assert.equal(code, 1);
});

test('cli: plan verify-facts stamps facts.json, warns on misses, and exits 0', async () => {
	const { cwd, factsPath } = await seedVerifyFactsFixture();

	const { stdout, stderr, code } = await runCli({ args: ['plan', 'verify-facts', '--name', 'demo', '--cwd', cwd] });

	assert.equal(code, 0);
	assert.equal(stderr, '');
	assert.match(stdout, /plan verify-facts demo — 1 area\(s\), verified /);
	assert.match(stdout, /paths: {3}2 checked · 1 missing/);
	assert.match(stdout, /scripts: 2 checked · 1 missing/);
	assert.match(stdout, /⚠ path not found: src\/missing\.ts/);
	assert.match(stdout, /⚠ script not found: nope/);
	assert.ok(stdout.endsWith(`\nfacts: ${factsPath}\n`));

	const stamped = JSON.parse(await readFile(factsPath, 'utf8'));
	assert.equal(stamped.request, 'add a widget');
	assert.deepEqual(stamped.verification, {
		pathsChecked: 2,
		missingPaths: ['src/missing.ts'],
		scriptsChecked: 2,
		missingScripts: ['nope'],
		createPathsThatExist: [],
	});
	assert.ok(!Number.isNaN(Date.parse(stamped.verifiedAt)));
});

// The engine's snapshot behavior (write-once, freeze-before-facts, missing
// source) is pinned in runPlanVerifyFacts.unit.test.ts; this test pins the CLI
// seam only — `--notes` reaches the engine as a cwd-relative notesFile.
test('cli: plan verify-facts --notes freezes the notes snapshot into the workspace and exits 0', async () => {
	const { cwd } = await seedVerifyFactsFixture();
	await writeFile(join(cwd, 'rough-notes.md'), '# Rough notes\n\nthe idea in plain words\n', 'utf8');

	const { stdout, stderr, code } = await runCli({ args: ['plan', 'verify-facts', '--name', 'demo', '--notes', 'rough-notes.md', '--cwd', cwd] });

	assert.equal(code, 0);
	assert.equal(stderr, '');
	assert.match(stdout, /plan verify-facts · notes frozen → /);
	const frozen = await readFile(join(cwd, '.lightsout', 'plans', 'demo', 'notes.md'), 'utf8');
	assert.equal(frozen, '# Rough notes\n\nthe idea in plain words\n');
});
