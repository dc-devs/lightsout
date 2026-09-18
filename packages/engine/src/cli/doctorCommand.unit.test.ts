import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from '@jest/globals';
import { doctorCommand } from '#src/cli/doctorCommand.ts';
import { captureCommandOutput } from '#tests/helpers/captureCommandOutput.ts';
import { setupConsumerRepo } from '#tests/helpers/setupConsumerRepo.ts';
import { usageFixture } from '#tests/helpers/usageFixture.ts';

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

/**
 * The healthy repo with `--usage-probe` on the flag map — both spellings the
 * flag can arrive in: the boolean form the dispatcher produces, and the
 * value-carrying form that is a usage error. The harness stub is what keeps the
 * boolean form off any real binary: the probe spawns whatever `claude` PATH
 * names, and the fake one answers at once.
 *
 * `harness` writes that name into the repo's config, for the reading where the
 * config names a harness rather than leaving the default. `codex` is the one
 * worth passing: its check answers without spawning anything at all.
 */
const setupUsageProbe = ({ value, harness }: { value: string | true; harness?: string }) => {
	const captured = captureCommandOutput();

	stubHarnessOnPath();

	const cwd = setupConsumerRepo({ config: harness ? { harness } : undefined });

	writeFileSync(join(cwd, '.gitignore'), '.lightsout\n');

	return { context: { flags: new Map<string, string | true>([['usage-probe', value]]), rest: [], cwd }, ...captured };
};

/**
 * `--usage-probe` asked for in a repo whose config does not parse — the one
 * arrangement where the warning line has no config to read the harness name
 * from. Nothing is spawned: runDoctor answers the broken config and stops.
 */
const setupUnparsableConfigProbe = () => {
	const captured = captureCommandOutput();
	const cwd = setupConsumerRepo({ git: false });

	writeFileSync(join(cwd, 'lightsout.config.json'), '{ "scripts": {} }');

	return { context: { flags: new Map<string, string | true>([['usage-probe', true]]), rest: [], cwd }, ...captured };
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

test('doctorCommand warns that the usage probe spends real money before running it', async () => {
	const { context, logged } = setupUsageProbe({ value: true });

	await expect(doctorCommand(context)).rejects.toThrow(/process\.exit/);

	// a check line is the first thing on the line, so the warning is any other
	// line naming the configured harness alongside the call it is about to make,
	// got: ${JSON.stringify(logged)}
	const isCheckLine = (line: string) => /^[✓ℹ⚠✗] /.test(line);
	const warningIndex = logged.findIndex((line) => !isCheckLine(line) && line.includes('claude-code') && /agent/i.test(line));
	const firstCheckIndex = logged.findIndex(isCheckLine);

	expect(warningIndex).toBeGreaterThanOrEqual(0);
	// the reader is told it is their own subscription being spent
	expect(logged[warningIndex] ?? '').toMatch(/subscription|spend|spent|money|bill|cost/i);
	// and told before the first check is reported, not after
	expect(firstCheckIndex).toBeGreaterThan(warningIndex);
	// the flag reached runDoctor: the probe's own check is among the reported ones
	expect(logged.some((line) => /^[✓ℹ⚠✗] harness-usage {3}\S/.test(line))).toBeTruthy();
});

test('doctorCommand refuses a --usage-probe carrying a value', async () => {
	const { context, logged, errors, exitCodes } = setupUsageProbe({ value: 'yes' });

	await expect(doctorCommand(context)).rejects.toThrow(/process\.exit/);

	// no header, no check line, no tally — nothing ran
	expect(logged).toStrictEqual([]);
	expect(errors).toStrictEqual([usageFixture]);
	expect(exitCodes).toStrictEqual([1]);
});

test('doctorCommand names the harness the config chose in the line it prints before probing', async () => {
	const { context, logged } = setupUsageProbe({ value: true, harness: 'codex' });

	await expect(doctorCommand(context)).rejects.toThrow(/process\.exit/);

	// same shape as the default-harness case: any line that is not a check line,
	// naming the harness alongside the call about to be made, got:
	// ${JSON.stringify(logged)}
	const isCheckLine = (line: string) => /^[✓ℹ⚠✗] /.test(line);
	const warning = logged.find((line) => !isCheckLine(line) && line.includes('codex') && /agent/i.test(line)) ?? '';

	expect(warning).toMatch(/subscription|spend|spent|money|bill|cost/i);
	// the configured name replaces the default rather than sitting beside it
	expect(warning).not.toMatch(/claude-code/);
	// and codex is reported as noted, not probed — a ℹ line, so nothing was spawned
	expect(logged.some((line) => /^ℹ harness-usage {3}\S/.test(line))).toBeTruthy();
});

test('doctorCommand still warns before probing when the config does not parse', async () => {
	const { context, logged, errors, exitCodes } = setupUnparsableConfigProbe();

	await expect(doctorCommand(context)).rejects.toThrow(/process\.exit/);

	// warning, header, the one ✗ check, its fix, the tally — got:
	// ${JSON.stringify(logged)}
	expect(logged.length).toBe(5);
	// the unreadable config falls back to the default harness name rather than throwing
	expect(logged[0] ?? '').toMatch(/claude-code/);
	expect(logged[0] ?? '').toMatch(/subscription|spend|spent|money|bill|cost/i);
	expect(logged[1]).toBe(`doctor    ${context.cwd}\n`);
	// the config failure is still the doctor's own report, not a stack trace
	expect(logged[2] ?? '').toMatch(/^✗ config {10}\S/);
	expect(logged[4]).toBe('\n1 check(s) · 1 fail');
	expect(errors).toStrictEqual([]);
	expect(exitCodes).toStrictEqual([1]);
});
