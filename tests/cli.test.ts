import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from '@jest/globals';

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
// removal of `verify`, 2026-08-08 for the plan-folder form of `implement`.)
const usage = `lightsout — deterministic engine for coding agents

usage:
  lightsout implement --plan <path> [--overview <path>] [--packages <a,b>] [--cwd <path>] [--skip-refactor]
  lightsout implement --plan <folder> [--start-phase <n>] [--cwd <path>] [--skip-refactor]   (folder: overview.md runs all phases, else plan.md)
  lightsout resume --run <id> [--cwd <path>] [--skip-refactor]
  lightsout status [--cwd <path>]
  lightsout doctor [--cwd <path>]
  lightsout standards-check [--cwd <path>] [--path <subdir>] [--all] [--baseline]
  lightsout standards-check --list [--cwd <path>]     (print the enforcement ledger)
  lightsout refactor [--cwd <path>] [--path <subdir>] [--all] [--max-batches <n>]
  lightsout refactor --run <id> [--cwd <path>]        (resume a parked refactor run)
  lightsout plan verify-facts --name <n> [--notes <path>] [--cwd <path>]
  lightsout plan draft --name <n> [--scope single|phased] [--cwd <path>]
  lightsout plan lint --name <n> [--cwd <path>]
  lightsout plan dedup --name <n> [--cwd <path>]
  lightsout plan grade --name <n> [--cwd <path>]
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

	expect(stdout).toBe('');
	expect(stderr).toBe(usageErr);
	expect(code).toBe(0);
});

test('cli: help prints usage to stderr and exits 0', async () => {
	const { stdout, stderr, code } = await runCli({ args: ['help'] });

	expect(stdout).toBe('');
	expect(stderr).toBe(usageErr);
	expect(code).toBe(0);
});

test('cli: an unknown command prints usage to stderr and exits 1', async () => {
	const { stdout, stderr, code } = await runCli({ args: ['nonsense'] });

	expect(stdout).toBe('');
	expect(stderr).toBe(usageErr);
	expect(code).toBe(1);
});

test('cli: status in a fresh dir reports no runs and exits 0', async () => {
	const cwd = await freshCwd();
	const { stdout, stderr, code } = await runCli({ args: ['status', '--cwd', cwd] });

	expect(stdout).toBe('no runs found\n');
	expect(stderr).toBe('');
	expect(code).toBe(0);
});

test('cli: friction in a fresh dir reports nothing recorded and exits 0', async () => {
	const cwd = await freshCwd();
	const { stdout, stderr, code } = await runCli({ args: ['friction', '--cwd', cwd] });

	expect(stdout).toBe('no friction recorded\n');
	expect(stderr).toBe('');
	expect(code).toBe(0);
});

// The dispatch table's doctor entry, end to end: a dir with no config is the
// one doctor outcome that needs no harness binary installed, so the route is
// observable without depending on the machine running the suite.
test('cli: doctor in a fresh dir fails on the missing config and exits 1', async () => {
	const cwd = await freshCwd();
	const { stdout, stderr, code } = await runCli({ args: ['doctor', '--cwd', cwd] });

	expect(stdout).toMatch(/^doctor {4}/);
	expect(stdout).toMatch(/✗ config/);
	expect(stdout).toMatch(/\n1 check\(s\) · 1 fail\n$/);
	expect(stderr).toBe('');
	expect(code).toBe(1);
});

test('cli: verify (removed command) prints usage to stderr and exits 1', async () => {
	const cwd = await freshCwd();
	const { stdout, stderr, code } = await runCli({ args: ['verify', '--cwd', cwd] });

	expect(stdout).toBe('');
	expect(stderr).toBe(usageErr);
	expect(code).toBe(1);
});

test('cli: implement without --plan prints usage to stderr and exits 1', async () => {
	const cwd = await freshCwd();
	const { stdout, stderr, code } = await runCli({ args: ['implement', '--cwd', cwd] });

	expect(stdout).toBe('');
	expect(stderr).toBe(usageErr);
	expect(code).toBe(1);
});

test('cli: plan explore (removed subcommand) prints usage to stderr and exits 1', async () => {
	const cwd = await freshCwd();
	const { stdout, stderr, code } = await runCli({ args: ['plan', 'explore', '--name', 'demo', '--cwd', cwd] });

	expect(stdout).toBe('');
	expect(stderr).toBe(usageErr);
	expect(code).toBe(1);
});

test('cli: plan verify-facts without --name prints usage to stderr and exits 1', async () => {
	const cwd = await freshCwd();
	const { stdout, stderr, code } = await runCli({ args: ['plan', 'verify-facts', '--cwd', cwd] });

	expect(stdout).toBe('');
	expect(stderr).toBe(usageErr);
	expect(code).toBe(1);
});

test('cli: plan verify-facts without an authored facts.json reports the error and exits 1', async () => {
	const cwd = await freshCwd();
	const { stdout, stderr, code } = await runCli({ args: ['plan', 'verify-facts', '--name', 'demo', '--cwd', cwd] });

	expect(stdout).toBe('');
	expect(stderr).toMatch(/no authored facts for plan demo/);
	expect(code).toBe(1);
});

test('cli: plan verify-facts with an unparsable facts.json reports the error and exits 1', async () => {
	const cwd = await freshCwd();
	const workspaceDir = join(cwd, '.lightsout', 'plans', 'demo');
	await mkdir(workspaceDir, { recursive: true });
	await writeFile(join(workspaceDir, 'facts.json'), '{"request": 42}', 'utf8');

	const { stdout, stderr, code } = await runCli({ args: ['plan', 'verify-facts', '--name', 'demo', '--cwd', cwd] });

	expect(stdout).toBe('');
	expect(stderr).not.toBe('');
	expect(code).toBe(1);
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

// A consumer repo with a plan deliverable and deliberately NO
// lightsout.config.json: `plan lint` is deterministic and must route before
// resolveConfigAndDriver, so it works where a config-dependent command would
// fail. The plan lives in its own folder, derived from cwd and name alone.
const seedPlanLintFixture = async ({ body }: { body: string }) => {
	const cwd = await freshCwd();
	const planDir = join(cwd, '.lightsout', 'plans', 'demo');

	await mkdir(join(cwd, 'src'), { recursive: true });
	await mkdir(planDir, { recursive: true });
	await writeFile(join(cwd, 'src', 'index.js'), 'export const one = 1;\n', 'utf8');
	await writeFile(join(planDir, 'plan.md'), body, 'utf8');

	return { cwd };
};

test('cli: plan lint without --name prints usage to stderr and exits 1', async () => {
	const cwd = await freshCwd();

	const { stdout, stderr, code } = await runCli({ args: ['plan', 'lint', '--cwd', cwd] });

	expect(stdout).toBe('');
	expect(stderr).toBe(usageErr);
	expect(code).toBe(1);
});

test('cli: plan lint on a clean plan reports clean and exits 0', async () => {
	const { cwd } = await seedPlanLintFixture({ body: cleanPlanBody });

	const { stdout, stderr, code } = await runCli({ args: ['plan', 'lint', '--name', 'demo', '--cwd', cwd] });

	expect(stderr).toBe('');
	expect(stdout).toMatch(/plan lint demo: 0 structural finding\(s\) across 1 file\(s\)/);
	expect(stdout).toMatch(/plan lint demo — clean \(1 file\(s\)\)/);
	// a clean plan prints no finding lines
	expect(stdout.includes('⚠')).toBeFalsy();
	expect(code).toBe(0);
});

test('cli: plan lint on a plan with a placeholder prints the finding and exits 1', async () => {
	const { cwd } = await seedPlanLintFixture({ body: cleanPlanBody.replace('A new module exporting', 'TBD — a new module exporting') });

	const { stdout, stderr, code } = await runCli({ args: ['plan', 'lint', '--name', 'demo', '--cwd', cwd] });

	expect(stderr).toBe('');
	expect(stdout).toMatch(/plan lint demo — 1 structural finding\(s\) \(1 file\(s\)\)/);
	expect(stdout).toMatch(/⚠ \[no-placeholders\] plan\.md:\d+ — unresolved placeholder 'TBD' present/);
	expect(stdout).toMatch(/fix: resolve 'TBD'/);
	expect(code).toBe(1);
});

test('cli: plan lint without a plan deliverable reports the error and exits 1', async () => {
	const cwd = await freshCwd();

	const { stdout, stderr, code } = await runCli({ args: ['plan', 'lint', '--name', 'ghost', '--cwd', cwd] });

	expect(stdout).toBe('');
	expect(stderr).toMatch(/no plan found for 'ghost'/);
	expect(code).toBe(1);
});

test('cli: plan verify-facts stamps facts.json, warns on misses, and exits 0', async () => {
	const { cwd, factsPath } = await seedVerifyFactsFixture();

	const { stdout, stderr, code } = await runCli({ args: ['plan', 'verify-facts', '--name', 'demo', '--cwd', cwd] });

	expect(code).toBe(0);
	expect(stderr).toBe('');
	expect(stdout).toMatch(/plan verify-facts demo — 1 area\(s\), verified /);
	expect(stdout).toMatch(/paths: {3}2 checked · 1 missing/);
	expect(stdout).toMatch(/scripts: 2 checked · 1 missing/);
	expect(stdout).toMatch(/⚠ path not found: src\/missing\.ts/);
	expect(stdout).toMatch(/⚠ script not found: nope/);
	expect(stdout.endsWith(`\nfacts: ${factsPath}\n`)).toBeTruthy();

	const stamped = JSON.parse(await readFile(factsPath, 'utf8'));
	expect(stamped.request).toBe('add a widget');
	expect(stamped.verification).toStrictEqual({
		pathsChecked: 2,
		missingPaths: ['src/missing.ts'],
		scriptsChecked: 2,
		missingScripts: ['nope'],
		createPathsThatExist: [],
	});
	expect(Number.isNaN(Date.parse(stamped.verifiedAt))).toBeFalsy();
});

// improve resolves its driver through the per-command config BEFORE the
// friction check, and its config load is non-fatal — both paths exit at the
// empty-friction early return, so no harness binary is ever spawned.
test('cli: improve with no config and no friction reports nothing to improve and exits 0', async () => {
	const cwd = await freshCwd();

	const { stdout, stderr, code } = await runCli({ args: ['improve', '--engine', cwd, '--cwd', cwd] });

	expect(stdout).toBe('no friction recorded — nothing to improve from\n');
	expect(stderr).toBe('');
	expect(code).toBe(0);
});

test('cli: improve resolves a commands.improve driver override from the config and exits 0', async () => {
	const cwd = await freshCwd();
	await writeFile(
		join(cwd, 'lightsout.config.json'),
		JSON.stringify({ scripts: { check: 'true', testUnit: 'true', testCoverage: false }, commands: { improve: { harness: 'codex' } } }),
		'utf8',
	);

	const { stdout, stderr, code } = await runCli({ args: ['improve', '--engine', cwd, '--cwd', cwd] });

	expect(stdout).toBe('no friction recorded — nothing to improve from\n');
	expect(stderr).toBe('');
	expect(code).toBe(0);
});

// A parked implement run plus a config naming a DIFFERENT harness. resume
// reconstructs its driver from the manifest's recorded harness, never from the
// config — and getDriver rejects an unknown name before any pipeline work, so
// the rule is observable here without spawning a harness binary.
const seedResumeFixture = async ({ manifestHarness, configHarness }: { manifestHarness: string; configHarness: string }) => {
	const cwd = await freshCwd();
	const runId = 'resume-harness-fixture';
	const runDir = join(cwd, '.lightsout', 'runs', runId);
	const now = new Date().toISOString();

	await mkdir(runDir, { recursive: true });
	await writeFile(
		join(cwd, 'lightsout.config.json'),
		JSON.stringify({ harness: configHarness, scripts: { check: 'true', testUnit: 'true', testCoverage: false } }),
		'utf8',
	);
	await writeFile(
		join(runDir, 'manifest.json'),
		JSON.stringify({
			runId,
			createdAt: now,
			updatedAt: now,
			plan: 'plans/demo.md',
			harness: manifestHarness,
			status: 'failed',
			currentStep: null,
			steps: [],
			changedFiles: [],
		}),
		'utf8',
	);

	return { cwd, runId };
};

test('cli: resume reconstructs the driver from the manifest harness, never the config harness', async () => {
	const { cwd, runId } = await seedResumeFixture({ manifestHarness: 'retired-harness', configHarness: 'codex' });

	const { stdout, stderr, code } = await runCli({ args: ['resume', '--run', runId, '--cwd', cwd] });

	// the failure lands before the run header is printed
	expect(stdout).toBe('');
	expect(stderr).toMatch(/unknown driver: retired-harness/);
	// the config's harness is never what resume reconstructs
	expect(stderr.includes('unknown driver: codex')).toBeFalsy();
	expect(code).toBe(1);
});

// The engine's snapshot behavior (write-once, freeze-before-facts, missing
// source) is pinned in runPlanVerifyFacts.unit.test.ts; this test pins the CLI
// seam only — `--notes` reaches the engine as a cwd-relative notesFile.
test('cli: plan verify-facts --notes freezes the notes snapshot into the workspace and exits 0', async () => {
	const { cwd } = await seedVerifyFactsFixture();
	await writeFile(join(cwd, 'rough-notes.md'), '# Rough notes\n\nthe idea in plain words\n', 'utf8');

	const { stdout, stderr, code } = await runCli({ args: ['plan', 'verify-facts', '--name', 'demo', '--notes', 'rough-notes.md', '--cwd', cwd] });

	expect(code).toBe(0);
	expect(stderr).toBe('');
	expect(stdout).toMatch(/plan verify-facts · notes frozen → /);
	const frozen = await readFile(join(cwd, '.lightsout', 'plans', 'demo', 'notes.md'), 'utf8');
	expect(frozen).toBe('# Rough notes\n\nthe idea in plain words\n');
});

// A consumer repo with the gate config every mutating command demands, and
// nothing else — enough for `refactor` to get past loadConfig and reach its
// own argument checks.
const seedConfiguredCwd = async () => {
	const cwd = await freshCwd();

	await writeFile(join(cwd, 'lightsout.config.json'), JSON.stringify({ scripts: { check: 'true', testUnit: 'true', testCoverage: false } }), 'utf8');

	return cwd;
};

// One seeded run manifest — enough for every `status` line and every `resume`
// pre-flight refusal, none of which spawn a harness. `lock` plants
// .lightsout/lock.json, the live-process probe that tells a genuinely running
// run apart from a crash leftover.
const seedRunFixture = async ({ status, pipeline, lock }: { status: string; pipeline?: string; lock?: { pid: number; runId: string } }) => {
	const cwd = await seedConfiguredCwd();
	const runId = 'run-fixture';
	const runDir = join(cwd, '.lightsout', 'runs', runId);
	const now = new Date().toISOString();

	await mkdir(runDir, { recursive: true });
	await writeFile(
		join(runDir, 'manifest.json'),
		JSON.stringify({
			runId,
			createdAt: now,
			updatedAt: now,
			plan: 'plans/demo.md',
			pipeline,
			harness: 'claude-code',
			status,
			currentStep: null,
			steps: [],
			changedFiles: [],
		}),
		'utf8',
	);

	if (lock) {
		await writeFile(join(cwd, '.lightsout', 'lock.json'), JSON.stringify({ ...lock, startedAt: now }), 'utf8');
	}

	return { cwd, runId, updatedAt: now };
};

test('cli: status lists each run with its status, plan, and last update', async () => {
	const { cwd, runId, updatedAt } = await seedRunFixture({ status: 'failed' });

	const { stdout, stderr, code } = await runCli({ args: ['status', '--cwd', cwd] });

	expect(stdout).toBe(`${runId}  failed  plan: plans/demo.md  updated: ${updatedAt}\n`);
	expect(stderr).toBe('');
	expect(code).toBe(0);
});

test('cli: status reports a running run with no live process as a resumable crash', async () => {
	const { cwd } = await seedRunFixture({ status: 'running' });

	const { stdout, stderr, code } = await runCli({ args: ['status', '--cwd', cwd] });

	expect(stdout).toMatch(/^run-fixture {2}running \(no live process — crashed\? resume with --run run-fixture\) {2}plan: plans\/demo\.md {2}updated: /);
	expect(stderr).toBe('');
	expect(code).toBe(0);
});

test('cli: status leaves a running run alone while the lock names a live process', async () => {
	const { cwd } = await seedRunFixture({ status: 'running', lock: { pid: process.pid, runId: 'run-fixture' } });

	const { stdout, stderr, code } = await runCli({ args: ['status', '--cwd', cwd] });

	expect(stdout).toMatch(/^run-fixture {2}running {2}plan: plans\/demo\.md {2}updated: /);
	// a live lock for this very run is proof it is not a crash leftover
	expect(stdout.includes('no live process')).toBeFalsy();
	expect(stderr).toBe('');
	expect(code).toBe(0);
});

test('cli: status skips a run whose manifest cannot be read and still lists the rest', async () => {
	const { cwd } = await seedRunFixture({ status: 'failed' });
	await mkdir(join(cwd, '.lightsout', 'runs', 'corrupt-run'), { recursive: true });
	await writeFile(join(cwd, '.lightsout', 'runs', 'corrupt-run', 'manifest.json'), 'not json at all', 'utf8');

	const { stdout, stderr, code } = await runCli({ args: ['status', '--cwd', cwd] });

	// an unreadable manifest is skipped, never guessed at
	expect(stdout.includes('corrupt-run')).toBeFalsy();
	expect(stdout).toMatch(/^run-fixture {2}failed {2}plan: plans\/demo\.md/m);
	expect(stderr).toBe('');
	expect(code).toBe(0);
});

test('cli: resume without --run prints usage to stderr and exits 1', async () => {
	const cwd = await freshCwd();

	const { stdout, stderr, code } = await runCli({ args: ['resume', '--cwd', cwd] });

	expect(stdout).toBe('');
	expect(stderr).toBe(usageErr);
	expect(code).toBe(1);
});

test('cli: resume refuses a refactor run and names the command that owns it', async () => {
	const { cwd, runId } = await seedRunFixture({ status: 'failed', pipeline: 'refactor' });

	const { stdout, stderr, code } = await runCli({ args: ['resume', '--run', runId, '--cwd', cwd] });

	expect(stdout).toBe('');
	expect(stderr).toBe(`run ${runId} belongs to the refactor pipeline — resume it with: lightsout refactor --run ${runId}\n`);
	expect(code).toBe(1);
});

test('cli: resume refuses a run that already passed', async () => {
	const { cwd, runId } = await seedRunFixture({ status: 'passed' });

	const { stdout, stderr, code } = await runCli({ args: ['resume', '--run', runId, '--cwd', cwd] });

	expect(stdout).toBe('');
	expect(stderr).toBe(`run ${runId} already passed — nothing to resume\n`);
	expect(code).toBe(1);
});

test('cli: resume takes the shortened run id a report prints, not just the full one', async () => {
	const { cwd, runId } = await seedRunFixture({ status: 'passed' });

	// printResult shows eight characters; that is what a user copies back
	const { stdout, stderr, code } = await runCli({ args: ['resume', '--run', runId.slice(0, 8), '--cwd', cwd] });

	// reaching the already-passed refusal proves the short id found the run
	expect(stdout).toBe('');
	expect(stderr).toBe(`run ${runId} already passed — nothing to resume\n`);
	expect(code).toBe(1);
});

test('cli: resume names an unknown run id instead of failing on the file it tried to open', async () => {
	const { cwd } = await seedRunFixture({ status: 'failed' });

	const { stdout, stderr, code } = await runCli({ args: ['resume', '--run', 'ghost', '--cwd', cwd] });

	expect(stdout).toBe('');
	expect(stderr).toBe(`no run matching 'ghost' — list the runs this repo has with: lightsout status\n`);
	expect(code).toBe(1);
});

test('cli: refactor rejects a --max-batches below one and exits 1', async () => {
	const cwd = await seedConfiguredCwd();

	const { stdout, stderr, code } = await runCli({ args: ['refactor', '--max-batches', '0', '--cwd', cwd] });

	expect(stdout).toBe('');
	expect(stderr).toBe("--max-batches must be a positive integer, got '0'\n");
	expect(code).toBe(1);
});

test('cli: refactor rejects a non-numeric --max-batches and exits 1', async () => {
	const cwd = await seedConfiguredCwd();

	const { stdout, stderr, code } = await runCli({ args: ['refactor', '--max-batches', 'lots', '--cwd', cwd] });

	expect(stdout).toBe('');
	expect(stderr).toBe("--max-batches must be a positive integer, got 'lots'\n");
	expect(code).toBe(1);
});

test('cli: refactor reports an unknown --run and exits 1 before starting anything', async () => {
	const cwd = await seedConfiguredCwd();

	const { stdout, stderr, code } = await runCli({ args: ['refactor', '--run', 'ghost', '--cwd', cwd] });

	// the refusal lands before the "resuming run" line is printed
	expect(stdout).toBe('');
	expect(stderr).toBe(`no run matching 'ghost' — list the runs this repo has with: lightsout status\n`);
	expect(code).toBe(1);
});

// A repo with a planted tier-0 synonym pair split across two folders, and no
// node_modules — so the compiler-gated tiers degrade to a note, which is the
// other rendering path `standards-check` owns. `baseline` accepts the findings as debt
// first, so the suppression and --all paths are reachable.
const seedStandardsFixture = async ({ baseline = false }: { baseline?: boolean } = {}) => {
	const cwd = await freshCwd();

	await mkdir(join(cwd, 'src', 'a'), { recursive: true });
	await mkdir(join(cwd, 'src', 'b'), { recursive: true });
	await writeFile(join(cwd, 'src', 'a', 'getUserData.ts'), 'export const getUserData = () => 1;\n', 'utf8');
	await writeFile(join(cwd, 'src', 'b', 'fetchUserData.ts'), 'export const fetchUserData = () => 2;\n', 'utf8');

	if (baseline) {
		await runCli({ args: ['standards-check', '--baseline', '--cwd', cwd] });
	}

	return { cwd };
};

test('cli: standards-check prints each finding, the rule breakdown, and exits 0', async () => {
	const { cwd } = await seedStandardsFixture();

	const { stdout, stderr, code } = await runCli({ args: ['standards-check', '--cwd', cwd] });

	expect(stderr).toBe('');
	// each rule gets a heading carrying its severity and count
	expect(stdout).toMatch(/ℹ name-synonym · 1 advisory/);
	// the shared guidance is stated once, under the rows it covers
	expect(stdout).toContain('Likely one concept living under two names.');
	// and the tally is a table, closed off by the report path
	expect(stdout).toMatch(/│ name-synonym\s+│\s+—\s+│\s+1\s+│/);
	// the rule's summary rides under its own row — a rule id alone says nothing
	expect(stdout).toMatch(/│ export names differing only by synonym or word order\s+│/);
	expect(stdout).toMatch(/report: \.lightsout\/standards-check\.json\n$/);
	// the standards check reports; it never fails the caller
	expect(code).toBe(0);
});

test('cli: standards-check counts advisories apart from findings and does not call them debt', async () => {
	const { cwd } = await seedStandardsFixture();

	const { stdout, stderr, code } = await runCli({ args: ['standards-check', '--cwd', cwd] });

	// the fixture plants a synonym pair and the two unreferenced exports behind
	// it — all advice to weigh, none of it work
	expect(stdout).toMatch(/│ total\s+│\s+—\s+│\s+3\s+│/);
	// so the accept-as-debt hint stays quiet — advice is not a ledger entry
	expect(stdout.includes('--baseline')).toBeFalsy();
	expect(stderr).toBe('');
	expect(code).toBe(0);
});

test('cli: standards-check writes its typed report to .lightsout/standards-check.json', async () => {
	const { cwd } = await seedStandardsFixture();

	const { code } = await runCli({ args: ['standards-check', '--cwd', cwd] });

	const report = JSON.parse(await readFile(join(cwd, '.lightsout', 'standards-check.json'), 'utf8'));
	expect(report.path).toBe('.');
	// the evidence file carries the findings, not just the printed summary
	expect(report.findings.some((finding: { rule: string }) => finding.rule === 'name-synonym')).toBeTruthy();
	expect(code).toBe(0);
});

test('cli: standards-check renders a degraded check tier as a note instead of failing', async () => {
	const { cwd } = await seedStandardsFixture();

	const { stdout, stderr, code } = await runCli({ args: ['standards-check', '--cwd', cwd] });

	expect(stdout).toMatch(/ℹ [^\n]*no typescript resolvable from the target repo/);
	expect(stderr).toBe('');
	expect(code).toBe(0);
});

test('cli: standards-check --baseline writes the debt ledger and exits 0', async () => {
	const { cwd } = await seedStandardsFixture();

	const { stdout, stderr, code } = await runCli({ args: ['standards-check', '--baseline', '--cwd', cwd] });

	const ledger = JSON.parse(await readFile(join(cwd, 'lightsout.standards-baseline.json'), 'utf8'));
	expect(ledger.path).toBe('.');
	// the accepted sites are what future runs measure against
	expect(ledger.siteKeys.length > 0).toBeTruthy();
	expect(stdout).toMatch(/ℹ baseline written: \d+ site\(s\) accepted as existing debt/);
	expect(stderr).toBe('');
	expect(code).toBe(0);
});

test('cli: standards-check reports nothing new once the findings are baselined', async () => {
	const { cwd } = await seedStandardsFixture({ baseline: true });

	const { stdout, stderr, code } = await runCli({ args: ['standards-check', '--cwd', cwd] });

	// a baselined finding is accepted debt, not news
	expect(stdout.includes('name-synonym')).toBeFalsy();
	// nothing left to report reads as a sentence, not an empty table
	expect(stdout).toContain('clean — nothing blocking, no advisories');
	expect(stdout.includes('┌')).toBeFalsy();
	expect(stderr).toBe('');
	expect(code).toBe(0);
});

test('cli: standards-check --all reports the findings the baseline already accepted', async () => {
	const { cwd } = await seedStandardsFixture({ baseline: true });

	const { stdout, stderr, code } = await runCli({ args: ['standards-check', '--all', '--cwd', cwd] });

	// a baselined site is printed again under --all
	expect(stdout).toMatch(/ℹ name-synonym · 1 advisory/);
	expect(stderr).toBe('');
	expect(code).toBe(0);
});

test('cli: standards-check --list prints the enforcement ledger and runs no check', async () => {
	const { cwd } = await seedStandardsFixture();

	const { stdout, stderr, code } = await runCli({ args: ['standards-check', '--list', '--cwd', cwd] });

	// every rule is listed with the state it runs at and the doc it enforces
	expect(stdout).toMatch(/│ name-synonym\s+│\s+advisory\s+│\s+standards\/code\/style-guide\/conventions\/naming\.md\s+│/);
	expect(stdout).toMatch(/│ module-boundary\s+│\s+blocking\s+│/);
	// a rule's live numbers ride its summary line
	expect(stdout).toContain('minTokens 50');
	// the totals close it off
	expect(stdout).toMatch(/│ 37 rule\(s\)\s+│\s+21 blocking\s+│\s+16 advisory, 0 off\s+│/);
	// the eleven test-shape rules name the document they enforce
	expect(stdout).toMatch(/│ test-nested-describe\s+│\s+blocking\s+│\s+standards\/tests\/unit\/jest\/unit-testing\.md\s+│/);
	// and so do the paths-and-names rules, across the three docs they come from
	expect(stdout).toMatch(/│ path-banned-module-name\s+│\s+blocking\s+│\s+standards\/code\/architecture\/folder-structure\.md\s+│/);
	expect(stdout).toMatch(/│ path-common-barrel\s+│\s+blocking\s+│\s+standards\/code\/style-guide\/structure\/module-api\.md\s+│/);
	expect(stdout).toMatch(/│ path-folder-casing\s+│\s+advisory\s+│\s+standards\/code\/architecture\/folder-structure\.md\s+│/);
	// --list answers a question about configuration — it never checks the tree
	expect(stdout.includes('report: .lightsout/standards-check.json')).toBeFalsy();
	expect(stderr).toBe('');
	expect(code).toBe(0);
});

test('cli: standards-check --list marks the rules this repo configured', async () => {
	const { cwd } = await seedStandardsFixture();

	await writeFile(
		join(cwd, 'lightsout.config.json'),
		JSON.stringify({ scripts: { check: 'true', testUnit: 'true', testCoverage: false }, standardsChecks: { 'name-synonym': 'off' } }),
		'utf8',
	);

	const { stdout, code } = await runCli({ args: ['standards-check', '--list', '--cwd', cwd] });

	// "this is our policy" reads apart from "this is the default"
	expect(stdout).toMatch(/│ name-synonym\s+│\s+off \(config\)\s+│/);
	expect(stdout).toMatch(/│ 37 rule\(s\)\s+│\s+21 blocking\s+│\s+15 advisory, 1 off\s+│/);
	expect(code).toBe(0);
});

test('cli: standards-check --path narrows the run to one subtree', async () => {
	const { cwd } = await seedStandardsFixture();

	const { stdout, stderr, code } = await runCli({ args: ['standards-check', '--path', 'src/a', '--cwd', cwd] });

	// the synonym pair is split by the narrowed scope, so tier 0 has nothing to
	// pair
	expect(stdout.includes('name-synonym')).toBeFalsy();
	const report = JSON.parse(await readFile(join(cwd, '.lightsout', 'standards-check.json'), 'utf8'));
	// the flag reaches the engine as the checked subpath
	expect(report.path).toBe('src/a');
	expect(stderr).toBe('');
	expect(code).toBe(0);
});
