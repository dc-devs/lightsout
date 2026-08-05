import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test, type TestContext } from 'node:test';
import { doctorCommand } from '@/cli/doctorCommand';
import { captureCommandOutput } from '@tests/helpers/captureCommandOutput';
import { setupConsumerRepo } from '@tests/helpers/setupConsumerRepo';

/**
 * doctorCommand hands runDoctor no probe seam, so the harness check shells the
 * real `claude --version`. A stub binary at the front of PATH is what makes that
 * probe deterministic here — without it the check's status would depend on
 * whatever the machine running the suite happens to have installed.
 */
const stubHarnessOnPath = ({ t }: { t: TestContext }) => {
	const binDir = mkdtempSync(join(tmpdir(), 'lightsout-doctor-bin-'));
	const wasPath = process.env.PATH;

	writeFileSync(join(binDir, 'claude'), '#!/bin/sh\necho "9.9.9 (Fake Claude)"\n', { mode: 0o755 });

	process.env.PATH = `${binDir}:${wasPath ?? ''}`;
	t.after(() => {
		process.env.PATH = wasPath ?? '';
	});
};

/** A consumer repo no doctor check fails on: valid config, ignored run state, resolvable gate binaries, a harness that answers. */
const setupHealthyRepo = ({ t }: { t: TestContext }) => {
	const captured = captureCommandOutput({ t });

	stubHarnessOnPath({ t });

	const cwd = setupConsumerRepo();

	// The bare-directory spelling git resolves for every run-state path.
	writeFileSync(join(cwd, '.gitignore'), '.lightsout\n');

	return { context: { flags: new Map<string, string | true>(), rest: [], cwd }, ...captured };
};

/** A valid repo with an empty PATH: the harness probe finds no binary, so the run mixes passing, warning and failing checks. */
const setupRepoWithNoHarness = ({ t }: { t: TestContext }) => {
	const captured = captureCommandOutput({ t });
	const emptyBinDir = mkdtempSync(join(tmpdir(), 'lightsout-doctor-nobin-'));
	const wasPath = process.env.PATH;

	process.env.PATH = emptyBinDir;
	t.after(() => {
		process.env.PATH = wasPath ?? '';
	});

	const cwd = setupConsumerRepo({ git: false });

	return { context: { flags: new Map<string, string | true>(), rest: [], cwd }, ...captured };
};

/** A repo whose config does not parse — runDoctor returns that single fail and checks nothing else. */
const setupBrokenConfig = ({ t }: { t: TestContext }) => {
	const captured = captureCommandOutput({ t });
	const cwd = setupConsumerRepo({ git: false });

	writeFileSync(join(cwd, 'lightsout.config.json'), '{ "scripts": {} }');

	return { context: { flags: new Map<string, string | true>(), rest: [], cwd }, ...captured };
};

test('doctorCommand: a healthy repo prints the cwd header, an icon line per check, a tally of the statuses present, and exits 0', async (t) => {
	const { context, logged, errors, exitCodes } = setupHealthyRepo({ t });

	await assert.rejects(doctorCommand(context), /process\.exit/);

	assert.equal(logged[0], `doctor    ${context.cwd}\n`);
	assert.ok(
		logged.some((line) => /^✓ config {10}lightsout\.config\.json valid · harness claude-code$/.test(line)),
		`the config check renders with its id padded to a 16-column gutter, got: ${JSON.stringify(logged)}`,
	);
	assert.ok(
		logged.some((line) => /^✓ harness {9}claude 9\.9\.9 \(Fake Claude\)/.test(line)),
		`the harness check reports the probed version, got: ${JSON.stringify(logged)}`,
	);
	assert.ok(
		logged.some((line) => /^ℹ lint-rules {6}no linter config found/.test(line)),
		`a note renders with the ℹ icon and carries no fix line, got: ${JSON.stringify(logged)}`,
	);
	assert.ok(!logged.some((line) => line.startsWith('✗')), 'no check fails on a healthy repo');
	assert.match(logged.at(-1) ?? '', /^\n\d+ check\(s\) · \d+ pass · \d+ note$/, 'zero-count statuses are dropped from the tally');
	assert.deepEqual(errors, []);
	assert.deepEqual(exitCodes, [0]);
});

test('doctorCommand: an unparsable config prints the single ✗ check with its fix indented under the gutter, and exits 1', async (t) => {
	const { context, logged, errors, exitCodes } = setupBrokenConfig({ t });

	await assert.rejects(doctorCommand(context), /process\.exit/);

	assert.equal(logged.length, 4, `header, one check line, one fix line, one tally — got: ${JSON.stringify(logged)}`);
	assert.equal(logged[0], `doctor    ${context.cwd}\n`);
	assert.match(logged[1] ?? '', /^✗ config {10}\S/);
	assert.match(logged[2] ?? '', /^ {18}create or repair lightsout\.config\.json — every other check depends on it$/);
	assert.equal(logged[3], '\n1 check(s) · 1 fail');
	assert.deepEqual(errors, []);
	assert.deepEqual(exitCodes, [1]);
});

test('doctorCommand: a repo whose harness binary is absent renders a mixed tally, prints the ✗ check and exits 1', async (t) => {
	const { context, logged, exitCodes } = setupRepoWithNoHarness({ t });

	await assert.rejects(doctorCommand(context), /process\.exit/);

	assert.ok(
		logged.some((line) => /^✗ harness {9}/.test(line)),
		`the harness check fails when its binary is not on PATH, got: ${JSON.stringify(logged)}`,
	);
	assert.match(logged.at(-1) ?? '', /^\n\d+ check\(s\) ·(?: \d+ \w+ ·)* \d+ fail$/, 'every non-zero status is tallied, fails last');
	assert.deepEqual(exitCodes, [1]);
});
