import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { extractRunScriptName } from '../common/utils/extractRunScriptName';
import { loadConfig } from '../index';
import { runGates } from './index';
import { gateLogCommand } from '../../tests/helpers/gateLogCommand';
import { readGateLog } from '../../tests/helpers/readGateLog';

test('extractRunScriptName reads the script after a run token, stepping over flags', () => {
	assert.equal(extractRunScriptName({ command: 'pnpm --filter @acme/api run check' }), 'check');
	assert.equal(extractRunScriptName({ command: 'pnpm run --if-present test:unit' }), 'test:unit');
	assert.equal(extractRunScriptName({ command: 'turbo run check --filter=@acme/api' }), 'check');
	assert.equal(extractRunScriptName({ command: 'npm run test:unit:coverage --workspace=@acme/api' }), 'test:unit:coverage');
	assert.equal(extractRunScriptName({ command: 'pnpm --filter @acme/api test' }), undefined);
	assert.equal(extractRunScriptName({ command: 'pnpm --filter @acme/api run' }), undefined);
});

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

	const template = ({ kind, script }: { kind: string; script: string }) =>
		`${gateLogCommand({ kind })} {package}${withRunToken ? ` run ${script}` : ''}`;

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

	assert.equal(error, undefined);

	const gates = readGateLog({ dir });

	assert.ok(gates.includes('@acme/api check'), 'package with scripts ran its gates');
	assert.ok(gates.includes('@acme/api testUnit'));
	assert.ok(!gates.some((line) => line.startsWith('@acme/bare ')), 'scriptless package ran nothing');
	assert.ok(progress.includes('gate [bare] check: skipped (no "gate:check" script)'), `narrated:\n${progress.join('\n')}`);
	assert.ok(progress.includes('gate [bare] testUnit: skipped (no "gate:test" script)'));

	const records = readFileSync(join(dir, '.lightsout', 'runs', 'run-skip', 'commands.jsonl'), 'utf8')
		.trim()
		.split('\n')
		.map((line) => JSON.parse(line) as Record<string, unknown>);
	const skips = records.filter((record) => record.skipped === true);

	assert.deepEqual(
		skips.map((record) => [record.group, record.kind, record.reason]),
		[
			['bare', 'check', 'no "gate:check" script'],
			['bare', 'testUnit', 'no "gate:test" script'],
		],
	);
	assert.ok(
		skips.every((record) => !('exitCode' in record)),
		'a skipped gate records no exit code — nothing ran',
	);
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

	assert.equal(error, undefined);

	const gates = readGateLog({ dir });

	assert.ok(gates.includes('@acme/api coverage'), 'coverage ran where the script exists');
	assert.ok(!gates.includes('@acme/api testUnit'), 'coverage replaced the plain test run');
	assert.ok(gates.includes('@acme/semi testUnit'), 'coverage-less package fell back to plain tests');
	assert.ok(!gates.includes('@acme/semi coverage'));
	assert.ok(progress.includes('gate [semi] testCoverage: skipped (no "gate:coverage" script)'));
});

test('a template with no run token always executes — unknown script is not missing script', async () => {
	const dir = setupScopedRepo({ withRunToken: false });
	const error = await runGates({
		cwd: dir,
		config: await loadConfig({ cwd: dir }),
		packages: ['bare'],
	});

	assert.equal(error, undefined);
	assert.ok(readGateLog({ dir }).includes('@acme/bare check'), 'unparseable template ran as-is');
});
