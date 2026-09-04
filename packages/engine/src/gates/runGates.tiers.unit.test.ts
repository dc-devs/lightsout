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

/**
 * A gate command that logs "root <kind>" exactly as a green one does, then
 * exits 1. Logging the red too is what makes gates.log the whole record of
 * which gates executed, rather than only the ones that passed.
 */
const redGate = ({ kind }: { kind: string }) => `${gateLogCommand({ kind })} root; exit 1`;

// The known jest worker segfault, as `runGates.flake.unit.test.ts` fabricates
// it: the SIGSEGV line beside a tally that names no failing test. The engine
// re-runs this gate, never blames a test family for it, and still ends red.
const jestWorkerSigsegv = 'A jest worker process (pid=49337) was terminated by another process: signal=SIGSEGV, exitCode=null.';
const crashTally = 'Test Suites: 1 failed, 3 passed, 4 total\\nTests:       11 passed, 11 total';
const crashingGate = `node -e "process.stderr.write('${jestWorkerSigsegv}\\n${crashTally}'); process.exit(1)"`;

interface TieredRepoParams {
	/** Replaces the green, logging check gate. */
	check?: string;
	/** Replaces the green, logging unit-test gate. */
	unit?: string;
}

/**
 * A single-package consumer carrying one gate of each tier: the cheap `check`
 * and `test`, and the expensive `test-e2e` and `build`. Every gate logs
 * "root <kind>" to gates.log, so the log names exactly which gates executed and
 * in which order. The two cheap gates are overridable, because the tier
 * boundary is only observable when one of them is red.
 */
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
 * A monorepo consumer with two packages and the same four scoped gate kinds,
 * each logging "<package> <kind>". One scoped template fans out to both
 * packages, so the red is selected inside the command by comparing the
 * substituted package name — no template carries a `run <script>` token, so
 * every one of them executes rather than being script-detected and skipped.
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
		// the cheap tier finished, and the boundary stopped there: the end-to-end
		// suite and the build were never paid for at a checkpoint already red
		expect(readGateLog({ dir })).toStrictEqual(['root check', 'root test']);
	});

	test('a red check still lets the unit suite run, so every cheap failure aggregates into one report', async () => {
		const dir = setupTieredRepo({ check: redGate({ kind: 'check' }), unit: redGate({ kind: 'test' }) });
		const config = await readConfig({ cwd: dir });

		const { error, failedFamilies } = await runGates({ cwd: dir, config, failFast: false, schedule: { kind: GateScheduleKind.Tiered } });

		// only the tier boundary stops a run: within a tier every gate still runs,
		// so one repair round can fix everything red at once
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
		// tiering reorders nothing: the two stages laid end to end are the same
		// canonical order an untiered run has always produced
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
		// the barrier is across the whole scope, not per package: web's cheap gates
		// both ran, and neither package's expensive gates started once api went red.
		// The two groups run in parallel, so the log's order is not the claim.
		expect([...readGateLog({ dir })].sort()).toStrictEqual(['@acme/api check', '@acme/api test', '@acme/web check', '@acme/web test']);
	});

	test('a crashed cheap gate holds the expensive tier, because the checkpoint produced no verdict', async () => {
		const dir = setupTieredRepo({ unit: crashingGate });
		const config = await readConfig({ cwd: dir });

		const result = await runGates({ cwd: dir, config, failFast: false, schedule: { kind: GateScheduleKind.Tiered } });

		// a crash is red without being evidence about the code, so it names no
		// family to repair — and the checkpoint that proved nothing still must not
		// spend the expensive tier
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
		// one stage, stopped at its first red — the unit suite never ran, which a
		// tiered run with this caller's complete-report mode would have let happen
		expect(readGateLog({ dir })).toStrictEqual(['root check']);
		// and no tier was held, because there was no tier boundary to hold one at
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

		// a suite that stops appearing in the log is indistinguishable from a
		// broken runner unless one line says why, and names what went red
		expect(held).toHaveLength(1);
		expect(held[0] ?? '').toContain('check, test');
	});
});
