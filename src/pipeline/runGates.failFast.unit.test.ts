import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from '@jest/globals';
import { gateLogCommand } from '@tests/helpers/gateLogCommand';
import { setupConsumerRepo } from '@tests/helpers/setupConsumerRepo';
import { loadConfig } from '@/common/utils/loadConfig';
import type { GateResult } from '@/contracts';
import { runGates } from '@/pipeline';

const red = 'node -e "process.exit(1)"';

test('failFast: false runs every gate and aggregates all failures', async () => {
	const dir = setupConsumerRepo({ scripts: { check: red, testUnit: red } });
	const config = await loadConfig({ cwd: dir });
	const gates: GateResult[] = [];

	const error = await runGates({ cwd: dir, config, failFast: false, onGateResult: (result) => gates.push(result) });

	expect(error ?? '').toMatch(/check failed/);
	expect(error ?? '').toMatch(/test-unit failed/);

	const check = gates.filter((gate) => gate.kind === 'check');
	const testUnit = gates.filter((gate) => gate.kind === 'testUnit');

	// both gates executed and reported
	expect(check.length >= 1 && testUnit.length >= 1).toBeTruthy();
	// every red execution carries an outputTail
	expect(gates.filter((gate) => gate.exitCode !== undefined && gate.exitCode !== 0).every((gate) => gate.outputTail !== undefined)).toBeTruthy();
});

test('failFast omitted: the first red wins — later gates never execute', async () => {
	const dir = setupConsumerRepo({ scripts: { check: red, testUnit: red } });
	const config = await loadConfig({ cwd: dir });
	const gates: GateResult[] = [];

	const error = await runGates({ cwd: dir, config, onGateResult: (result) => gates.push(result) });

	expect(error ?? '').toMatch(/check failed/);
	// test run short-circuited by the red check
	expect(/test-unit failed/.test(error ?? '')).toBeFalsy();
	// only the check gate executed
	expect(gates.every((gate) => gate.kind === 'check')).toBeTruthy();
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

	const error = await runGates({
		cwd: dir,
		config: await loadConfig({ cwd: dir }),
		packages: ['api'],
		failFast: false,
		onGateResult: (result) => gates.push(result),
	});

	expect(error ?? '').toMatch(/\[api\] check failed/);
	expect(error ?? '').toMatch(/\[api\] test-unit failed/);

	// scoped check gate executed and reported red
	expect(gates.some((gate) => gate.group === 'api' && gate.kind === 'check' && gate.exitCode !== 0)).toBeTruthy();
	// scoped test gate ran despite the red check — failFast reached the scoped set
	expect(gates.some((gate) => gate.group === 'api' && gate.kind === 'testUnit' && gate.exitCode !== 0)).toBeTruthy();
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

	// bare package's missing check reported as a skip:\n${JSON.stringify(skips)}
	expect(skips.some((gate) => gate.group === 'bare' && gate.kind === 'check' && gate.reason === 'no "gate:check" script')).toBeTruthy();
	// a skipped gate reports no exit code
	expect(skips.every((gate) => gate.exitCode === undefined)).toBeTruthy();
});
