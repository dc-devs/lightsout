import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from '@jest/globals';
import { doctorCommand } from '@/cli/doctorCommand';
import { captureCommandOutput } from '@tests/helpers/captureCommandOutput';
import { setupConsumerRepo } from '@tests/helpers/setupConsumerRepo';

/**
 * doctorCommand hands runDoctor no probe seam, so the harness check shells the
 * real `claude --version`. A stub binary at the front of PATH is what makes that
 * probe deterministic here — without it the check's status would depend on
 * whatever the machine running the suite happens to have installed.
 */
const stubHarnessOnPath = () => {
	const binDir = mkdtempSync(join(tmpdir(), 'lightsout-doctor-bin-'));
	const wasPath = process.env.PATH;

	writeFileSync(join(binDir, 'claude'), '#!/bin/sh\necho "9.9.9 (Fake Claude)"\n', { mode: 0o755 });

	process.env.PATH = `${binDir}:${wasPath ?? ''}`;
};

/** A consumer repo no doctor check fails on: valid config, ignored run state, resolvable gate binaries, a harness that answers. */
const setupHealthyRepo = () => {
	const captured = captureCommandOutput();

	stubHarnessOnPath();

	const cwd = setupConsumerRepo();

	// The bare-directory spelling git resolves for every run-state path.
	writeFileSync(join(cwd, '.gitignore'), '.lightsout\n');

	return { context: { flags: new Map<string, string | true>(), rest: [], cwd }, ...captured };
};

/** A valid repo with an empty PATH: the harness probe finds no binary, so the run mixes passing, warning and failing checks. */
const setupRepoWithNoHarness = () => {
	const captured = captureCommandOutput();
	const emptyBinDir = mkdtempSync(join(tmpdir(), 'lightsout-doctor-nobin-'));
	const wasPath = process.env.PATH;

	process.env.PATH = emptyBinDir;

	const cwd = setupConsumerRepo({ git: false });

	return { context: { flags: new Map<string, string | true>(), rest: [], cwd }, ...captured };
};

/** A repo whose config does not parse — runDoctor returns that single fail and checks nothing else. */
const setupBrokenConfig = () => {
	const captured = captureCommandOutput();
	const cwd = setupConsumerRepo({ git: false });

	writeFileSync(join(cwd, 'lightsout.config.json'), '{ "scripts": {} }');

	return { context: { flags: new Map<string, string | true>(), rest: [], cwd }, ...captured };
};

test('doctorCommand: a healthy repo prints the cwd header, an icon line per check, a tally of the statuses present, and exits 0', async () => {
	const { context, logged, errors, exitCodes } = setupHealthyRepo();

	await expect(doctorCommand(context)).rejects.toThrow(/process\.exit/);

	expect(logged[0]).toBe(`doctor    ${context.cwd}\n`);
	// the config check renders with its id padded to a 16-column gutter, got:
	// ${JSON.stringify(logged)}
	expect(logged.some((line) => /^✓ config {10}lightsout\.config\.json valid · harness claude-code$/.test(line))).toBeTruthy();
	// the harness check reports the probed version, got: ${JSON.stringify(logged)}
	expect(logged.some((line) => /^✓ harness {9}claude 9\.9\.9 \(Fake Claude\)/.test(line))).toBeTruthy();
	// a note renders with the ℹ icon and carries no fix line, got:
	// ${JSON.stringify(logged)}
	expect(logged.some((line) => /^ℹ lint-rules {6}no linter config found/.test(line))).toBeTruthy();
	// no check fails on a healthy repo
	expect(logged.some((line) => line.startsWith('✗'))).toBeFalsy();
	// zero-count statuses are dropped from the tally
	expect(logged.at(-1) ?? '').toMatch(/^\n\d+ check\(s\) · \d+ pass · \d+ note$/);
	expect(errors).toStrictEqual([]);
	expect(exitCodes).toStrictEqual([0]);
});

test('doctorCommand: an unparsable config prints the single ✗ check with its fix indented under the gutter, and exits 1', async () => {
	const { context, logged, errors, exitCodes } = setupBrokenConfig();

	await expect(doctorCommand(context)).rejects.toThrow(/process\.exit/);

	// header, one check line, one fix line, one tally — got:
	// ${JSON.stringify(logged)}
	expect(logged.length).toBe(4);
	expect(logged[0]).toBe(`doctor    ${context.cwd}\n`);
	expect(logged[1] ?? '').toMatch(/^✗ config {10}\S/);
	expect(logged[2] ?? '').toMatch(/^ {18}create or repair lightsout\.config\.json — every other check depends on it$/);
	expect(logged[3]).toBe('\n1 check(s) · 1 fail');
	expect(errors).toStrictEqual([]);
	expect(exitCodes).toStrictEqual([1]);
});

test('doctorCommand: a repo whose harness binary is absent renders a mixed tally, prints the ✗ check and exits 1', async () => {
	const { context, logged, exitCodes } = setupRepoWithNoHarness();

	await expect(doctorCommand(context)).rejects.toThrow(/process\.exit/);

	// the harness check fails when its binary is not on PATH, got:
	// ${JSON.stringify(logged)}
	expect(logged.some((line) => /^✗ harness {9}/.test(line))).toBeTruthy();
	// every non-zero status is tallied, fails last
	expect(logged.at(-1) ?? '').toMatch(/^\n\d+ check\(s\) ·(?: \d+ \w+ ·)* \d+ fail$/);
	expect(exitCodes).toStrictEqual([1]);
});
