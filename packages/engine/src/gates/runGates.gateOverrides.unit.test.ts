import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, test } from '@jest/globals';
import { readConfig } from '#src/common/config/readConfig.ts';
import type { GateResult } from '#src/contracts/index.ts';
import { GateScheduleKind, runGates } from '#src/gates/index.ts';
import { gateLogCommand } from '#tests/helpers/gateLogCommand.ts';
import { readGateLog } from '#tests/helpers/readGateLog.ts';
import { setupConsumerRepo } from '#tests/helpers/setupConsumerRepo.ts';

const red = 'node -e "process.exit(1)"';

/**
 * A single-package consumer whose every verification gate logs "root <kind>",
 * so which gates ran — and in which order — is readable off gates.log.
 */
const setupRootRepo = ({ scripts }: { scripts?: Record<string, string | false> } = {}) =>
	setupConsumerRepo({
		scripts: {
			check: `${gateLogCommand({ kind: 'check' })} root`,
			test: `${gateLogCommand({ kind: 'test' })} root`,
			'test-coverage': `${gateLogCommand({ kind: 'coverage' })} root`,
			'test-e2e': `${gateLogCommand({ kind: 'e2e' })} root`,
			build: `${gateLogCommand({ kind: 'build' })} root`,
			...scripts,
		},
	});

/**
 * A consumer whose custom suite and build gates exist ONLY in the scoped
 * block, so a run of the root group alone has no entry for either — the
 * reachable case for an override that names gates nothing running can execute.
 */
const setupSplitBlockRepo = () =>
	setupConsumerRepo({
		scripts: {
			check: `${gateLogCommand({ kind: 'check' })} root`,
			test: `${gateLogCommand({ kind: 'test' })} root`,
		},
		config: {
			'package-gates': {
				check: `${gateLogCommand({ kind: 'check' })} {package}`,
				test: `${gateLogCommand({ kind: 'test' })} {package}`,
				'test-e2e': `${gateLogCommand({ kind: 'e2e' })} {package}`,
				build: `${gateLogCommand({ kind: 'build' })} {package}`,
			},
		},
	});

/**
 * A monorepo whose one package defines the check and test gate scripts but not
 * the custom suite's, so the suite is script-detected as absent and skipped.
 */
const setupScopedRepo = () => {
	const dir = mkdtempSync(join(tmpdir(), 'lightsout-gate-overrides-'));

	mkdirSync(join(dir, 'packages', 'partial'), { recursive: true });
	writeFileSync(
		join(dir, 'packages', 'partial', 'package.json'),
		JSON.stringify({ name: '@acme/partial', scripts: { 'gate:check': 'unused', 'gate:test': 'unused' } }),
	);

	writeFileSync(
		join(dir, 'lightsout.config.json'),
		JSON.stringify({
			gates: { check: 'true', test: 'true', 'test-coverage': false },
			'package-gates': {
				check: `${gateLogCommand({ kind: 'check' })} {package} run gate:check`,
				test: `${gateLogCommand({ kind: 'test' })} {package} run gate:test`,
				'test-e2e': `${gateLogCommand({ kind: 'e2e' })} {package} run gate:e2e`,
			},
		}),
	);

	return dir;
};

describe('runGates', () => {
	test('an override runs exactly the gates it names, in the order it names them', async () => {
		const dir = setupRootRepo();
		const config = await readConfig({ cwd: dir });
		const gates: GateResult[] = [];

		const { error } = await runGates({
			cwd: dir,
			config,
			schedule: { kind: GateScheduleKind.Exact, gates: ['build', 'check'] },
			onGateResult: (result) => gates.push(result),
		});

		expect(error).toBe(undefined);
		// the list is the whole schedule: build runs before check even though the
		// engine's own order and its tier split both put check first, and the two
		// gates the list never names do not run at all
		expect(gates.map((gate) => gate.kind)).toStrictEqual(['build', 'check']);
		expect(readGateLog({ dir })).toStrictEqual(['root build', 'root check']);
	});

	test('an override of "off" runs no gates at all, generate included', async () => {
		const dir = setupRootRepo({ scripts: { generate: `${gateLogCommand({ kind: 'generate' })} root` } });
		const config = await readConfig({ cwd: dir });
		const gates: GateResult[] = [];

		const result = await runGates({ cwd: dir, config, schedule: { kind: GateScheduleKind.Off }, onGateResult: (gate) => gates.push(gate) });

		expect(result).toStrictEqual({ error: undefined, failedFamilies: [], crashes: [] });
		// "off" is the one spelling that means "run nothing" on purpose, and the
		// codegen command a gate set would normally run first is nothing either
		expect(gates).toStrictEqual([]);
		expect(readGateLog({ dir })).toStrictEqual([]);
	});

	test("generate runs before an override's list, exactly as it does under the default schedule", async () => {
		const dir = setupRootRepo({ scripts: { generate: `${gateLogCommand({ kind: 'generate' })} root` } });
		const config = await readConfig({ cwd: dir });
		const gates: GateResult[] = [];

		const { error } = await runGates({
			cwd: dir,
			config,
			schedule: { kind: GateScheduleKind.Exact, gates: ['test'] },
			onGateResult: (result) => gates.push(result),
		});

		expect(error).toBe(undefined);
		// generate writes the files gates read, so it is a precondition of running
		// them rather than a gate an override chooses between
		expect(gates.map((gate) => gate.kind)).toStrictEqual(['generate', 'test']);
		expect(readGateLog({ dir })).toStrictEqual(['root generate', 'root test']);
	});

	test('a red gate stops the rest of an override list', async () => {
		const dir = setupRootRepo({ scripts: { check: red } });
		const config = await readConfig({ cwd: dir });
		const gates: GateResult[] = [];

		const { error, failedFamilies } = await runGates({
			cwd: dir,
			config,
			failFast: false,
			schedule: { kind: GateScheduleKind.Exact, gates: ['check', 'test'] },
			onGateResult: (result) => gates.push(result),
		});

		expect(error ?? '').toMatch(/check failed \(exit 1\)/);
		expect(failedFamilies).toStrictEqual(['check']);
		// the checkpoint asked for the complete report, and an override list
		// overrules it: the declared order is the whole reason to write one, so a
		// red gate stops what was ordered behind it
		expect(/test failed/.test(error ?? '')).toBeFalsy();
		expect(gates.map((gate) => gate.kind)).toStrictEqual(['check']);
		expect(readGateLog({ dir })).toStrictEqual([]);
	});

	test('an override gate a package has no script for is skipped with evidence, and the rest of its list runs', async () => {
		const dir = setupScopedRepo();
		const config = await readConfig({ cwd: dir });
		const progress: string[] = [];

		const { error, failedFamilies } = await runGates({
			cwd: dir,
			config,
			packages: ['partial'],
			schedule: { kind: GateScheduleKind.Exact, gates: ['test-e2e', 'check'] },
			onProgress: (message) => progress.push(message),
		});

		expect(error).toBe(undefined);
		expect(failedFamilies).toStrictEqual([]);
		// an override changes which gates are scheduled, not whether every package
		// in scope must own one — the missing suite is skipped with evidence and
		// the rest of the list carries on
		expect(progress.includes('gate [partial] test-e2e: skipped (no "gate:e2e" script)')).toBeTruthy();
		expect(readGateLog({ dir })).toStrictEqual(['@acme/partial check']);
	});

	test('an override naming test-coverage runs it where the step asked for none', async () => {
		const dir = setupRootRepo();
		const config = await readConfig({ cwd: dir });
		const gates: GateResult[] = [];

		const { error } = await runGates({
			cwd: dir,
			config,
			coverage: false,
			schedule: { kind: GateScheduleKind.Exact, gates: ['test-coverage'] },
			onGateResult: (result) => gates.push(result),
		});

		expect(error).toBe(undefined);
		// the list replaces the engine's choice entirely, so the step's coverage
		// answer no longer decides whether the coverage gate is scheduled
		expect(gates.map((gate) => gate.kind)).toStrictEqual(['testCoverage']);
		expect(readGateLog({ dir })).toStrictEqual(['root coverage']);
	});

	test('an override that matches no gate in any running group fails, naming the gates it asked for', async () => {
		const dir = setupSplitBlockRepo();
		const config = await readConfig({ cwd: dir });
		const gates: GateResult[] = [];

		const result = await runGates({
			cwd: dir,
			config,
			schedule: { kind: GateScheduleKind.Exact, gates: ['test-e2e', 'build'] },
			onGateResult: (gate) => gates.push(gate),
		});

		// both names are gates this repo configures, but only under the scoped
		// block — the root group that runs here has neither, so reporting green
		// would be a checkpoint claiming a verdict it never earned
		expect(result.error ?? '').toMatch(/gate-overrides named no gate this run could execute: test-e2e, build/);
		// nothing about the code went red, so nothing is handed to a fix agent
		expect(result.failedFamilies).toStrictEqual([]);
		expect(result.crashes).toStrictEqual([]);
		expect(gates).toStrictEqual([]);
		expect(readGateLog({ dir })).toStrictEqual([]);
	});

	test('an override that matches some of its gates runs those and passes', async () => {
		const dir = setupSplitBlockRepo();
		const config = await readConfig({ cwd: dir });
		const gates: GateResult[] = [];

		const { error, failedFamilies } = await runGates({
			cwd: dir,
			config,
			schedule: { kind: GateScheduleKind.Exact, gates: ['check', 'build'] },
			onGateResult: (result) => gates.push(result),
		});

		// a partial match is evidence: the gate that ran is green, and the one the
		// root group has no entry for takes nothing down with it
		expect(error).toBe(undefined);
		expect(failedFamilies).toStrictEqual([]);
		expect(gates.map((gate) => gate.kind)).toStrictEqual(['check']);
		expect(readGateLog({ dir })).toStrictEqual(['root check']);
	});
});
