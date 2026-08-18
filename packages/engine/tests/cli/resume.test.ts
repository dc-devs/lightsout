import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { expect, test } from '@jest/globals';
import { freshCwd } from '@tests/helpers/freshCwd';
import { runCli } from '@tests/helpers/runCli';
import { seedRunFixture } from '@tests/helpers/seedRunFixture';

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
		JSON.stringify({ harness: configHarness, gates: { check: 'true', test: 'true', testCoverage: false } }),
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

test('cli: resume refuses a refactor run and names the command that owns it', async () => {
	const { cwd, runId } = await seedRunFixture({ status: 'failed', pipeline: 'refactor' });

	const { stdout, stderr, code } = await runCli({ args: ['resume', '--run', runId, '--cwd', cwd] });

	expect(stdout).toBe('');
	expect(stderr).toMatch(/belongs to the refactor pipeline/);
	// the command in the hint is what a user copies back — that string is contract, the sentence around it is not
	expect(stderr).toContain(`lightsout refactor --run ${runId}`);
	expect(code).toBe(1);
});

test('cli: resume refuses a run that already passed', async () => {
	const { cwd, runId } = await seedRunFixture({ status: 'passed' });

	const { stdout, stderr, code } = await runCli({ args: ['resume', '--run', runId, '--cwd', cwd] });

	expect(stdout).toBe('');
	expect(stderr).toMatch(/already passed/);
	expect(code).toBe(1);
});

test('cli: resume takes the shortened run id a report prints, not just the full one', async () => {
	const { cwd, runId } = await seedRunFixture({ status: 'passed' });

	// printResult shows eight characters; that is what a user copies back
	const { stdout, stderr, code } = await runCli({ args: ['resume', '--run', runId.slice(0, 8), '--cwd', cwd] });

	// reaching the already-passed refusal for the FULL id proves the short id found the run
	expect(stdout).toBe('');
	expect(stderr).toMatch(/already passed/);
	expect(stderr).toContain(runId);
	expect(code).toBe(1);
});

test('cli: resume names an unknown run id instead of failing on the file it tried to open', async () => {
	const { cwd } = await seedRunFixture({ status: 'failed' });

	const { stdout, stderr, code } = await runCli({ args: ['resume', '--run', 'ghost', '--cwd', cwd] });

	expect(stdout).toBe('');
	expect(stderr).toMatch(/no run matching 'ghost'/);
	expect(code).toBe(1);
});
