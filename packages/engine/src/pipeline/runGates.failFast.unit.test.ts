import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import type { GateResult } from '@lightsout/contracts';
import { loadConfig } from '../index';
import { runGates } from './index';
import { setupConsumerRepo } from '../../tests/helpers/setupConsumerRepo';
import { gateLogCommand } from '../../tests/helpers/gateLogCommand';

const red = 'node -e "process.exit(1)"';

test('failFast: false runs every gate and aggregates all failures', async () => {
	const dir = setupConsumerRepo({ scripts: { check: red, testUnit: red } });
	const config = await loadConfig({ cwd: dir });
	const gates: GateResult[] = [];

	const error = await runGates({ cwd: dir, config, failFast: false, onGateResult: (result) => gates.push(result) });

	assert.match(error ?? '', /check failed/);
	assert.match(error ?? '', /test-unit failed/);

	const check = gates.filter((gate) => gate.kind === 'check');
	const testUnit = gates.filter((gate) => gate.kind === 'testUnit');

	assert.ok(check.length >= 1 && testUnit.length >= 1, 'both gates executed and reported');
	assert.ok(
		gates.filter((gate) => gate.exitCode !== undefined && gate.exitCode !== 0).every((gate) => gate.outputTail !== undefined),
		'every red execution carries an outputTail',
	);
});

test('failFast omitted: the first red wins — later gates never execute', async () => {
	const dir = setupConsumerRepo({ scripts: { check: red, testUnit: red } });
	const config = await loadConfig({ cwd: dir });
	const gates: GateResult[] = [];

	const error = await runGates({ cwd: dir, config, onGateResult: (result) => gates.push(result) });

	assert.match(error ?? '', /check failed/);
	assert.ok(!/test-unit failed/.test(error ?? ''), 'test run short-circuited by the red check');
	assert.ok(
		gates.every((gate) => gate.kind === 'check'),
		'only the check gate executed',
	);
});

test('failFast: false threads into scoped groups — every red gate in a package aggregates', async () => {
	const dir = mkdtempSync(join(tmpdir(), 'lightsout-failfast-scoped-'));

	mkdirSync(join(dir, 'packages', 'api'), { recursive: true });
	writeFileSync(join(dir, 'packages', 'api', 'package.json'), JSON.stringify({ name: '@acme/api', scripts: { 'gate:check': 'x', 'gate:test': 'x' } }));

	writeFileSync(
		join(dir, 'lightsout.config.json'),
		JSON.stringify({
			scripts: { check: 'true', testUnit: 'true', testCoverage: false },
			packageScripts: {
				check: `${red} {package} run gate:check`,
				testUnit: `${red} {package} run gate:test`,
			},
		}),
	);

	const gates: GateResult[] = [];

	const error = await runGates({ cwd: dir, config: await loadConfig({ cwd: dir }), packages: ['api'], failFast: false, onGateResult: (result) => gates.push(result) });

	assert.match(error ?? '', /\[api\] check failed/);
	assert.match(error ?? '', /\[api\] test-unit failed/);

	assert.ok(
		gates.some((gate) => gate.group === 'api' && gate.kind === 'check' && gate.exitCode !== 0),
		'scoped check gate executed and reported red',
	);
	assert.ok(
		gates.some((gate) => gate.group === 'api' && gate.kind === 'testUnit' && gate.exitCode !== 0),
		'scoped test gate ran despite the red check — failFast reached the scoped set',
	);
});

test('a scoped skip surfaces through onGateResult as a skipped entry', async () => {
	const dir = mkdtempSync(join(tmpdir(), 'lightsout-failfast-test-'));

	for (const [pkgDir, scripts] of [
		['api', { 'gate:check': 'unused', 'gate:test': 'unused' }],
		['bare', {}],
	] as const) {
		mkdirSync(join(dir, 'packages', pkgDir), { recursive: true });
		writeFileSync(join(dir, 'packages', pkgDir, 'package.json'), JSON.stringify({ name: `@acme/${pkgDir}`, scripts }));
	}

	writeFileSync(
		join(dir, 'lightsout.config.json'),
		JSON.stringify({
			scripts: { check: 'echo root-check', testUnit: 'echo root-test', testCoverage: false },
			packageScripts: {
				check: `${gateLogCommand({ kind: 'check' })} {package} run gate:check`,
				testUnit: `${gateLogCommand({ kind: 'testUnit' })} {package} run gate:test`,
			},
		}),
	);

	const gates: GateResult[] = [];

	await runGates({ cwd: dir, config: await loadConfig({ cwd: dir }), packages: ['api', 'bare'], onGateResult: (result) => gates.push(result) });

	const skips = gates.filter((gate) => gate.skipped === true);

	assert.ok(
		skips.some((gate) => gate.group === 'bare' && gate.kind === 'check' && gate.reason === 'no "gate:check" script'),
		`bare package's missing check reported as a skip:\n${JSON.stringify(skips)}`,
	);
	assert.ok(
		skips.every((gate) => gate.exitCode === undefined),
		'a skipped gate reports no exit code',
	);
});
