import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from '@jest/globals';
import { gateLogCommand } from '@tests/helpers/gateLogCommand';
import { readGateLog } from '@tests/helpers/readGateLog';
import { loadConfig } from '@/common/utils/loadConfig';
import { runGates } from '@/pipeline';

/**
 * A consumer dir with packages whose gate scripts vary, and scoped templates
 * shaped `<log command> {package} run <script>` — the log command ignores the
 * trailing `run <script>` tokens, which exist so the engine's script-name
 * extraction sees a real workspace-runner shape.
 */
const setupScopedRepo = ({ withRunToken = true }: { withRunToken?: boolean } = {}) => {
	const dir = mkdtempSync(join(tmpdir(), 'lightsout-skip-test-'));

	for (const [pkgDir, scripts] of [
		['api', { 'gate:check': 'unused', 'gate:test': 'unused', 'gate:coverage': 'unused' }],
		['semi', { 'gate:check': 'unused', 'gate:test': 'unused' }],
		['bare', {}],
	] as const) {
		mkdirSync(join(dir, 'packages', pkgDir), { recursive: true });
		writeFileSync(join(dir, 'packages', pkgDir, 'package.json'), JSON.stringify({ name: `@acme/${pkgDir}`, scripts }));
	}

	const template = ({ kind, script }: { kind: string; script: string }) => `${gateLogCommand({ kind })} {package}${withRunToken ? ` run ${script}` : ''}`;

	writeFileSync(
		join(dir, 'lightsout.config.json'),
		JSON.stringify({
			scripts: { check: 'echo root-check', testUnit: 'echo root-test', testCoverage: false },
			packageScripts: {
				check: template({ kind: 'check', script: 'gate:check' }),
				testUnit: template({ kind: 'testUnit', script: 'gate:test' }),
				testCoverage: template({ kind: 'coverage', script: 'gate:coverage' }),
			},
		}),
	);

	return dir;
};

test('a package without a gate script is skipped with narration and a log record, not failed', async () => {
	const dir = setupScopedRepo();
	const progress: string[] = [];
	const error = await runGates({
		cwd: dir,
		config: await loadConfig({ cwd: dir }),
		packages: ['api', 'bare'],
		runId: 'run-skip',
		step: 'clean-slate',
		onProgress: (message) => progress.push(message),
	});

	expect(error).toBe(undefined);

	const gates = readGateLog({ dir });

	// package with scripts ran its gates
	expect(gates.includes('@acme/api check')).toBeTruthy();
	expect(gates.includes('@acme/api testUnit')).toBeTruthy();
	// scriptless package ran nothing
	expect(gates.some((line) => line.startsWith('@acme/bare '))).toBeFalsy();
	// narrated:\n${progress.join('\n')}
	expect(progress.includes('gate [bare] check: skipped (no "gate:check" script)')).toBeTruthy();
	expect(progress.includes('gate [bare] testUnit: skipped (no "gate:test" script)')).toBeTruthy();

	const records = readFileSync(join(dir, '.lightsout', 'runs', 'run-skip', 'commands.jsonl'), 'utf8')
		.trim()
		.split('\n')
		.map((line) => JSON.parse(line) as Record<string, unknown>);
	const skips = records.filter((record) => record.skipped === true);

	expect(skips.map((record) => [record.group, record.kind, record.reason])).toStrictEqual([
		['bare', 'check', 'no "gate:check" script'],
		['bare', 'testUnit', 'no "gate:test" script'],
	]);
	// a skipped gate records no exit code — nothing ran
	expect(skips.every((record) => !('exitCode' in record))).toBeTruthy();
});

test('a package missing only the coverage script falls back to its plain test run', async () => {
	const dir = setupScopedRepo();
	const progress: string[] = [];
	const error = await runGates({
		cwd: dir,
		config: await loadConfig({ cwd: dir }),
		packages: ['api', 'semi'],
		coverage: true,
		onProgress: (message) => progress.push(message),
	});

	expect(error).toBe(undefined);

	const gates = readGateLog({ dir });

	// coverage ran where the script exists
	expect(gates.includes('@acme/api coverage')).toBeTruthy();
	// coverage replaced the plain test run
	expect(gates.includes('@acme/api testUnit')).toBeFalsy();
	// coverage-less package fell back to plain tests
	expect(gates.includes('@acme/semi testUnit')).toBeTruthy();
	expect(gates.includes('@acme/semi coverage')).toBeFalsy();
	expect(progress.includes('gate [semi] testCoverage: skipped (no "gate:coverage" script)')).toBeTruthy();
});

test('a template with no run token always executes — unknown script is not missing script', async () => {
	const dir = setupScopedRepo({ withRunToken: false });
	const error = await runGates({
		cwd: dir,
		config: await loadConfig({ cwd: dir }),
		packages: ['bare'],
	});

	expect(error).toBe(undefined);
	// unparseable template ran as-is
	expect(readGateLog({ dir }).includes('@acme/bare check')).toBeTruthy();
});
