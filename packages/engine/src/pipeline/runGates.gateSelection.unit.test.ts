import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, test } from '@jest/globals';
import { loadConfig } from '#src/common/utils/loadConfig.ts';
import type { GateResult } from '#src/contracts/index.ts';
import { runGates } from '#src/pipeline/index.ts';
import { gateLogCommand } from '#tests/helpers/gateLogCommand.ts';
import { readGateLog } from '#tests/helpers/readGateLog.ts';
import { setupConsumerRepo } from '#tests/helpers/setupConsumerRepo.ts';

/** A single-package consumer whose config opts out of coverage (`gates.'test-coverage': false`), with gates that log "root <kind>". */
const setupOptedOutRepo = () =>
	setupConsumerRepo({
		scripts: {
			check: `${gateLogCommand({ kind: 'check' })} root`,
			test: `${gateLogCommand({ kind: 'test' })} root`,
		},
	});

/**
 * A monorepo consumer whose `packageGates` include the opt-in build template.
 * The templates carry no `run <script>` token, so every one of them executes
 * rather than being script-detected and skipped.
 */
const setupScopedBuildRepo = () => {
	const dir = mkdtempSync(join(tmpdir(), 'lightsout-gate-selection-'));

	mkdirSync(join(dir, 'packages', 'api'), { recursive: true });
	writeFileSync(join(dir, 'packages', 'api', 'package.json'), JSON.stringify({ name: '@acme/api' }));
	writeFileSync(
		join(dir, 'lightsout.config.json'),
		JSON.stringify({
			gates: { check: 'true', test: 'true', 'test-coverage': false },
			'package-gates': {
				check: `${gateLogCommand({ kind: 'check' })} {package}`,
				test: `${gateLogCommand({ kind: 'test' })} {package}`,
				build: `${gateLogCommand({ kind: 'build' })} {package}`,
			},
		}),
	);

	return dir;
};

/**
 * A monorepo consumer whose scoped block adds a custom `test-e2e` suite beside
 * the coverage and build templates. No template carries a `run <script>` token,
 * so every one of them executes rather than being script-detected and skipped.
 */
const setupScopedCustomSuiteRepo = () => {
	const dir = setupConsumerRepo({
		config: {
			'package-gates': {
				check: `${gateLogCommand({ kind: 'check' })} {package}`,
				test: `${gateLogCommand({ kind: 'test' })} {package}`,
				'test-coverage': `${gateLogCommand({ kind: 'coverage' })} {package}`,
				'test-e2e': `${gateLogCommand({ kind: 'e2e' })} {package}`,
				build: `${gateLogCommand({ kind: 'build' })} {package}`,
			},
		},
	});

	mkdirSync(join(dir, 'packages', 'api'), { recursive: true });
	writeFileSync(join(dir, 'packages', 'api', 'package.json'), JSON.stringify({ name: '@acme/api' }));

	return dir;
};

describe('runGates', () => {
	test('a coverage opt-out keeps the plain test gate, even when the run asks for coverage', async () => {
		const dir = setupOptedOutRepo();
		const config = await loadConfig({ cwd: dir });
		const gates: GateResult[] = [];

		const error = await runGates({ cwd: dir, config, coverage: true, onGateResult: (result) => gates.push(result) });

		expect(error).toBe(undefined);
		// `'test-coverage': false` is a decision, not a missing command — the run's
		// coverage request cannot revive a gate the consumer opted out of, and
		// the plain test gate must not be dropped along with it
		expect(gates.map((gate) => [gate.group, gate.kind])).toStrictEqual([
			['root', 'check'],
			['root', 'test'],
		]);
		expect(readGateLog({ dir })).toStrictEqual(['root check', 'root test']);
	});

	test('the scoped build gate runs last in a package group, after check and the test run', async () => {
		const dir = setupScopedBuildRepo();
		const config = await loadConfig({ cwd: dir });
		const gates: GateResult[] = [];

		const error = await runGates({ cwd: dir, config, packages: ['api'], onGateResult: (result) => gates.push(result) });

		expect(error).toBe(undefined);
		expect(gates.map((gate) => [gate.group, gate.kind])).toStrictEqual([
			['api', 'check'],
			['api', 'test'],
			['api', 'build'],
		]);
		// each template ran against the package.json name, not the directory
		expect(readGateLog({ dir })).toStrictEqual(['@acme/api check', '@acme/api test', '@acme/api build']);
	});

	test('a custom `test-*` suite runs after the unit run and before build, and coverage never substitutes it', async () => {
		const dir = setupConsumerRepo({
			scripts: {
				check: `${gateLogCommand({ kind: 'check' })} root`,
				test: `${gateLogCommand({ kind: 'test' })} root`,
				'test-coverage': `${gateLogCommand({ kind: 'coverage' })} root`,
				'test-e2e': `${gateLogCommand({ kind: 'e2e' })} root`,
				build: `${gateLogCommand({ kind: 'build' })} root`,
			},
		});
		const config = await loadConfig({ cwd: dir });
		const gates: GateResult[] = [];

		const error = await runGates({ cwd: dir, config, coverage: true, onGateResult: (result) => gates.push(result) });

		expect(error).toBe(undefined);
		// coverage replaces `test` alone — the custom suite is its own gate, in
		// order, with the expensive slots as late as the config allows
		expect(gates.map((gate) => gate.kind)).toStrictEqual(['check', 'testCoverage', 'test-e2e', 'build']);
	});

	test('a red custom suite fails the gate set under its own name', async () => {
		const dir = setupConsumerRepo({ scripts: { 'test-e2e': 'false' } });
		const config = await loadConfig({ cwd: dir });

		const error = await runGates({ cwd: dir, config, coverage: false });

		expect(error ?? '').toMatch(/test-e2e failed \(exit 1\)/);
	});

	test('a scoped custom `test-*` suite runs after the package test run and before its build, and coverage never substitutes it', async () => {
		const dir = setupScopedCustomSuiteRepo();
		const config = await loadConfig({ cwd: dir });
		const gates: GateResult[] = [];

		const error = await runGates({ cwd: dir, config, packages: ['api'], coverage: true, onGateResult: (result) => gates.push(result) });

		expect(error).toBe(undefined);
		// the substitution and the ordering hold inside a package group exactly as
		// they do at the root: coverage stands in for `test` alone, and the custom
		// suite keeps its own slot between the unit run and build
		expect(gates.map((gate) => [gate.group, gate.kind])).toStrictEqual([
			['api', 'check'],
			['api', 'testCoverage'],
			['api', 'test-e2e'],
			['api', 'build'],
		]);
		expect(readGateLog({ dir })).toStrictEqual(['@acme/api check', '@acme/api coverage', '@acme/api e2e', '@acme/api build']);
	});

	test('a red gate short-circuits a custom suite too — it never executes behind an earlier failure', async () => {
		const dir = setupConsumerRepo({
			scripts: {
				check: 'node -e "process.exit(1)"',
				'test-e2e': `${gateLogCommand({ kind: 'e2e' })} root`,
			},
		});
		const config = await loadConfig({ cwd: dir });

		const error = await runGates({ cwd: dir, config });

		expect(error ?? '').toMatch(/check failed \(exit 1\)/);
		// a custom suite is the most expensive gate a config can declare — running
		// it behind a red check spends the whole suite to learn nothing
		expect(/test-e2e failed/.test(error ?? '')).toBeFalsy();
		expect(readGateLog({ dir })).toStrictEqual([]);
	});
});
