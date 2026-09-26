import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, test } from '@jest/globals';
import { readConfig } from '#src/common/config/readConfig.ts';
import type { GateResult } from '#src/contracts/gates/GateResult.ts';
import { GateScheduleKind } from '#src/gates/common/constants/GateScheduleKind.ts';
import { runGates } from '#src/gates/runGates.ts';
import { gateLogCommand } from '#tests/helpers/gateLogCommand.ts';
import { readGateLog } from '#tests/helpers/readGateLog.ts';
import { setupConsumerRepo } from '#tests/helpers/setupConsumerRepo.ts';

/** Logs "root <kind>" like a green gate, then exits 1, so gates.log records red gates too. */
const redGate = ({ kind }: { kind: string }) => `${gateLogCommand({ kind })} root; exit 1`;

// A jest worker crash: the SIGSEGV line beside a tally that names no failing test.
const jestWorkerSigsegv = 'A jest worker process (pid=49337) was terminated by another process: signal=SIGSEGV, exitCode=null.';
const crashTally = 'Test Suites: 1 failed, 3 passed, 4 total\\nTests:       11 passed, 11 total';
const crashingGate = `node -e "process.stderr.write('${jestWorkerSigsegv}\\n${crashTally}'); process.exit(1)"`;

interface TieredRepoParams {
	/** Replaces the green, logging check gate. */
	check?: string;
	/** Replaces the green, logging unit-test gate. */
	unit?: string;
}

/** A single-package repo with one gate of each tier, each logging "root <kind>" to gates.log. */
const setupTieredRepo = ({ check, unit }: TieredRepoParams = {}) =>
	setupConsumerRepo({
		scripts: {
			check: check ?? `${gateLogCommand({ kind: 'check' })} root`,
			test: unit ?? `${gateLogCommand({ kind: 'test' })} root`,
			'test-e2e': `${gateLogCommand({ kind: 'e2e' })} root`,
			build: `${gateLogCommand({ kind: 'build' })} root`,
		},
	});

interface TieredMonorepoParams {
	/** The package.json name whose scoped check gate exits 1; every other package's goes green. */
	redCheckIn: string;
}

/**
 * Two packages sharing each scoped template, so the red is chosen inside the
 * command by package name. No template has a `run <script>` token, so none is skipped.
 */
const setupTieredMonorepo = ({ redCheckIn }: TieredMonorepoParams) => {
	const dir = mkdtempSync(join(tmpdir(), 'lightsout-tiers-mono-'));

	for (const packageDir of ['api', 'web']) {
		mkdirSync(join(dir, 'packages', packageDir), { recursive: true });
		writeFileSync(join(dir, 'packages', packageDir, 'package.json'), JSON.stringify({ name: `@acme/${packageDir}` }));
	}

	writeFileSync(
		join(dir, 'lightsout.config.json'),
		JSON.stringify({
			gates: { check: 'true', test: 'true', 'test-coverage': false },
			'package-gates': {
				check: `${gateLogCommand({ kind: 'check' })} {package}; [ "{package}" = "${redCheckIn}" ] && exit 1; exit 0`,
				test: `${gateLogCommand({ kind: 'test' })} {package}`,
				'test-e2e': `${gateLogCommand({ kind: 'e2e' })} {package}`,
				build: `${gateLogCommand({ kind: 'build' })} {package}`,
			},
		}),
	);

	return dir;
};

describe('runGates', () => {
	test('a red cheap gate holds the expensive tier — the custom suite and build never execute', async () => {
		const dir = setupTieredRepo({ check: redGate({ kind: 'check' }) });
		const config = await readConfig({ cwd: dir });

		const { error, failedFamilies } = await runGates({ cwd: dir, config, failFast: false, schedule: { kind: GateScheduleKind.Tiered } });

		expect(failedFamilies).toStrictEqual(['check']);
		expect(error ?? '').toMatch(/check failed \(exit 1\)/);
		expect(readGateLog({ dir })).toStrictEqual(['root check', 'root test']);
	});

	test('a red check still lets the unit suite run, so every cheap failure aggregates into one report', async () => {
		const dir = setupTieredRepo({ check: redGate({ kind: 'check' }), unit: redGate({ kind: 'test' }) });
		const config = await readConfig({ cwd: dir });

		const { error, failedFamilies } = await runGates({ cwd: dir, config, failFast: false, schedule: { kind: GateScheduleKind.Tiered } });

		expect(failedFamilies).toStrictEqual(['check', 'test']);
		expect(error ?? '').toMatch(/check failed \(exit 1\)/);
		expect(error ?? '').toMatch(/test failed \(exit 1\)/);
	});

	test("a green cheap tier runs the expensive gates in the engine's canonical order", async () => {
		const dir = setupTieredRepo();
		const config = await readConfig({ cwd: dir });
		const gates: GateResult[] = [];

		const { error } = await runGates({
			cwd: dir,
			config,
			failFast: false,
			schedule: { kind: GateScheduleKind.Tiered },
			onGateResult: (result) => gates.push(result),
		});

		expect(error).toBe(undefined);
		expect(gates.map((gate) => gate.kind)).toStrictEqual(['check', 'test', 'test-e2e', 'build']);
		expect(readGateLog({ dir })).toStrictEqual(['root check', 'root test', 'root e2e', 'root build']);
	});

	test('a red cheap gate in one package holds the expensive tier in every package in scope', async () => {
		const dir = setupTieredMonorepo({ redCheckIn: '@acme/api' });
		const config = await readConfig({ cwd: dir });

		const { error } = await runGates({
			cwd: dir,
			config,
			packages: ['api', 'web'],
			failFast: false,
			schedule: { kind: GateScheduleKind.Tiered },
		});

		expect(error ?? '').toMatch(/\[api\] check failed \(exit 1\)/);
		// the package groups run in parallel, so the log is sorted before comparing
		expect([...readGateLog({ dir })].sort()).toStrictEqual(['@acme/api check', '@acme/api test', '@acme/web check', '@acme/web test']);
	});

	test('a crashed cheap gate holds the expensive tier, because the checkpoint produced no verdict', async () => {
		const dir = setupTieredRepo({ unit: crashingGate });
		const config = await readConfig({ cwd: dir });

		const result = await runGates({ cwd: dir, config, failFast: false, schedule: { kind: GateScheduleKind.Tiered } });

		expect(result.failedFamilies).toStrictEqual([]);
		expect(result.crashes).toHaveLength(1);
		expect(result.error ?? '').toContain(jestWorkerSigsegv);
		expect(readGateLog({ dir })).toStrictEqual(['root check']);
	});

	test('a run with no schedule is not tiered — one stage, first red wins, as every non-checkpoint caller runs today', async () => {
		const dir = setupTieredRepo({ check: redGate({ kind: 'check' }) });
		const config = await readConfig({ cwd: dir });
		const progress: string[] = [];

		const { failedFamilies } = await runGates({ cwd: dir, config, onProgress: (message) => progress.push(message) });

		expect(failedFamilies).toStrictEqual(['check']);
		expect(readGateLog({ dir })).toStrictEqual(['root check']);
		expect(progress.filter((message) => /expensive gates not started/.test(message))).toStrictEqual([]);
	});

	test('the held tier is narrated once, naming the red families', async () => {
		const dir = setupTieredRepo({ check: redGate({ kind: 'check' }), unit: redGate({ kind: 'test' }) });
		const config = await readConfig({ cwd: dir });
		const progress: string[] = [];

		await runGates({
			cwd: dir,
			config,
			failFast: false,
			schedule: { kind: GateScheduleKind.Tiered },
			onProgress: (message) => progress.push(message),
		});

		const held = progress.filter((message) => /expensive gates not started/.test(message));

		expect(held).toHaveLength(1);
		expect(held[0] ?? '').toContain('check, test');
	});
});
