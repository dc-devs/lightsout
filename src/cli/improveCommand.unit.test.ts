import { chmodSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from '@jest/globals';
import { captureCommandOutput } from '@tests/helpers/captureCommandOutput';
import { parseFlags } from '@/cli/common/args/parseFlags';
import { improveCommand } from '@/cli/improveCommand';

// improve resolves its config and driver BEFORE the friction check, and its
// config load is non-fatal only when no config file exists — both arrangements
// end at the empty-friction early return, so no harness binary is ever spawned.
const setupImprove = ({ args, config }: { args: string[]; config?: Record<string, unknown> }) => {
	const captured = captureCommandOutput();
	const cwd = mkdtempSync(join(tmpdir(), 'lightsout-improve-command-'));

	if (config) {
		writeFileSync(join(cwd, 'lightsout.config.json'), JSON.stringify(config));
	}

	return { context: { flags: parseFlags({ args }), rest: [], cwd }, ...captured };
};

test('improveCommand: without --engine it prints the usage text on stderr and exits 1 before touching the config', async () => {
	const { context, logged, errors, exitCodes } = setupImprove({ args: [] });

	await expect(improveCommand(context)).rejects.toThrow(/process\.exit/);

	expect(logged).toStrictEqual([]);
	expect(errors.length).toBe(1);
	expect(errors[0] ?? '').toMatch(/^lightsout — deterministic engine for coding agents/);
	expect(errors[0] ?? '').toMatch(/lightsout improve --engine <lightsout-repo-path>/);
	expect(exitCodes).toStrictEqual([1]);
});

test('improveCommand: an --engine flag given with no value is not a value — it fails the same way', async () => {
	const { context, errors, exitCodes } = setupImprove({ args: ['--engine'] });

	await expect(improveCommand(context)).rejects.toThrow(/process\.exit/);

	expect(errors.length).toBe(1);
	expect(exitCodes).toStrictEqual([1]);
});

test('improveCommand: no recorded friction reports there is nothing to improve from and exits 0 without invoking a harness', async () => {
	const { context, logged, errors, exitCodes } = setupImprove({ args: ['--engine', '/does/not/need/to/exist'] });

	await expect(improveCommand(context)).rejects.toThrow(/process\.exit/);

	expect(logged).toStrictEqual(['no friction recorded — nothing to improve from']);
	expect(errors).toStrictEqual([]);
	expect(exitCodes).toStrictEqual([0]);
});

test('improveCommand: a present-but-invalid config is a hard error, not the missing-config fallback', async () => {
	const { context } = setupImprove({
		args: ['--engine', '/does/not/need/to/exist'],
		config: { driver: 'codex', scripts: { check: 'c', testUnit: 't', testCoverage: false } },
	});

	await expect(improveCommand(context)).rejects.toThrow(/renamed to `harness`/);
});

/**
 * The full path: friction on disk, prompt files in the engine repo, and a fake
 * `claude` on PATH that answers with the given report. Nothing else is stubbed —
 * the driver is the real one, spawning a real process.
 */
const setupImproveRun = ({
	report,
	friction = [{ area: 'prompt', detail: 'the executor guessed at scope' }],
}: {
	report: unknown;
	friction?: Record<string, unknown>[];
}) => {
	const captured = captureCommandOutput();
	const cwd = mkdtempSync(join(tmpdir(), 'lightsout-improve-run-'));
	const engineCwd = mkdtempSync(join(tmpdir(), 'lightsout-improve-engine-'));
	const binDir = join(cwd, 'bin');

	mkdirSync(join(cwd, '.lightsout'), { recursive: true });
	writeFileSync(
		join(cwd, '.lightsout', 'friction.jsonl'),
		friction.map((entry) => `${JSON.stringify({ at: '2026-01-01T00:00:00.000Z', runId: 'r1', step: 'implement', ...entry })}\n`).join(''),
	);

	mkdirSync(join(engineCwd, 'src/agents/prompts'), { recursive: true });
	writeFileSync(join(engineCwd, 'src/agents/prompts/executor.md'), '# executor\n');

	mkdirSync(binDir, { recursive: true });
	writeFileSync(join(binDir, 'claude'), `#!/bin/sh\ncat > /dev/null\nprintf '%s' '${JSON.stringify(report)}'\n`, 'utf8');
	chmodSync(join(binDir, 'claude'), 0o755);
	process.env.PATH = `${binDir}:${process.env.PATH ?? ''}`;

	return { context: { flags: parseFlags({ args: ['--engine', engineCwd] }), rest: [], cwd }, engineCwd, ...captured };
};

const changeReport = ({ status = 'complete', changedFiles = [] }: { status?: string; changedFiles?: { path: string; summary: string }[] } = {}) => ({
	status,
	summary: 'tightened the executor scope wording',
	changedFiles,
	failures: [],
});

test('improveCommand: a complete report is printed file by file and exits 0', async () => {
	const { context, logged, exitCodes, engineCwd } = setupImproveRun({
		report: changeReport({ changedFiles: [{ path: 'src/agents/prompts/executor.md', summary: 'named the scope rule' }] }),
	});

	await expect(improveCommand(context)).rejects.toThrow(/process\.exit/);

	expect(logged).toStrictEqual([
		'\nimprove: complete (1 friction entries considered)',
		'  tightened the executor scope wording',
		'  ~ src/agents/prompts/executor.md — named the scope rule',
		`\nreview the diff in ${engineCwd} — the loop proposes, a human ships.`,
	]);
	expect(exitCodes).toStrictEqual([0]);
});

test('improveCommand: a report that changed nothing skips the review prompt, because there is no diff to read', async () => {
	const { context, logged, exitCodes } = setupImproveRun({ report: changeReport() });

	await expect(improveCommand(context)).rejects.toThrow(/process\.exit/);

	expect(logged.some((line) => line.includes('review the diff'))).toBe(false);
	expect(exitCodes).toStrictEqual([0]);
});

test('improveCommand: a report that did not complete exits 1, so a caller can tell the loop fell short', async () => {
	const { context, exitCodes } = setupImproveRun({ report: changeReport({ status: 'failed' }) });

	await expect(improveCommand(context)).rejects.toThrow(/process\.exit/);

	expect(exitCodes).toStrictEqual([1]);
});

test('improveCommand: a harness that produces no valid report is an error, not an empty success', async () => {
	const { context, errors, exitCodes } = setupImproveRun({ report: 'not a report at all' });

	await expect(improveCommand(context)).rejects.toThrow(/process\.exit/);

	expect(errors.length).toBe(1);
	expect(exitCodes).toStrictEqual([1]);
});
