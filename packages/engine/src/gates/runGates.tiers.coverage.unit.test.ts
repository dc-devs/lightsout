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
 * exits 1 — so gates.log records the red execution too, and stays the whole
 * record of which gates ran.
 */
const redGate = ({ kind }: { kind: string }) => `${gateLogCommand({ kind })} root; exit 1`;

// The known jest worker segfault: the SIGSEGV line beside a tally that names no
// failing test. The engine re-runs this gate, blames no test family for it, and
// still ends red.
const jestWorkerSigsegv = 'A jest worker process (pid=49337) was terminated by another process: signal=SIGSEGV, exitCode=null.';
const crashTally = 'Test Suites: 1 failed, 3 passed, 4 total\\nTests:       11 passed, 11 total';
const crashingGate = `node -e "process.stderr.write('${jestWorkerSigsegv}\\n${crashTally}'); process.exit(1)"`;

interface TieredCoverageRepoParams {
	/** Replaces the green, logging unit-test gate. */
	unit?: string;
	/** Replaces the green, logging coverage gate. */
	coverageGate?: string;
	/** Replaces the green, logging custom-suite gate. */
	suite?: string;
}

/**
 * A single-package consumer carrying every verification gate kind, the coverage
 * one included: the cheap `check`, `test` and `test-coverage`, and the
 * expensive `test-e2e` and `build`. Each logs "root <kind>", so gates.log names
 * exactly which gates executed and in which order.
 */
const setupTieredCoverageRepo = ({ unit, coverageGate, suite }: TieredCoverageRepoParams = {}) =>
	setupConsumerRepo({
		scripts: {
			check: `${gateLogCommand({ kind: 'check' })} root`,
			test: unit ?? `${gateLogCommand({ kind: 'test' })} root`,
			'test-coverage': coverageGate ?? `${gateLogCommand({ kind: 'coverage' })} root`,
			'test-e2e': suite ?? `${gateLogCommand({ kind: 'e2e' })} root`,
			build: `${gateLogCommand({ kind: 'build' })} root`,
		},
	});

/**
 * A monorepo consumer with two packages and one scoped template per gate kind,
 * every one of them green. No template carries a `run <script>` token, so each
 * executes rather than being script-detected and skipped.
 */
const setupGreenTieredMonorepo = () => {
	const dir = mkdtempSync(join(tmpdir(), 'lightsout-tiers-green-mono-'));

	for (const packageDir of ['api', 'web']) {
		mkdirSync(join(dir, 'packages', packageDir), { recursive: true });
		writeFileSync(join(dir, 'packages', packageDir, 'package.json'), JSON.stringify({ name: `@acme/${packageDir}` }));
	}

	writeFileSync(
		join(dir, 'lightsout.config.json'),
		JSON.stringify({
			gates: { check: 'true', test: 'true', 'test-coverage': false },
			'package-gates': {
				check: `${gateLogCommand({ kind: 'check' })} {package}`,
				test: `${gateLogCommand({ kind: 'test' })} {package}`,
				'test-e2e': `${gateLogCommand({ kind: 'e2e' })} {package}`,
				build: `${gateLogCommand({ kind: 'build' })} {package}`,
			},
		}),
	);

	return dir;
};

describe('runGates', () => {
	test('the coverage gate is cheap — a red one holds the expensive tier', async () => {
		const dir = setupTieredCoverageRepo({ coverageGate: redGate({ kind: 'coverage' }) });
		const config = await readConfig({ cwd: dir });

		const { error, failedFamilies } = await runGates({
			cwd: dir,
			config,
			coverage: true,
			failFast: false,
			schedule: { kind: GateScheduleKind.Tiered },
		});

		expect(failedFamilies).toStrictEqual(['testCoverage']);
		expect(error ?? '').toMatch(/test-coverage failed \(exit 1\)/);
		// the instrumented unit suite is the same suite, so it belongs to the tier
		// the plain one does: it ran in the first stage, and its red held the
		// end-to-end suite and the build exactly as a red check would have
		expect(readGateLog({ dir })).toStrictEqual(['root check', 'root coverage']);
	});

	test('coverage replaces the plain unit suite inside the cheap tier, and the expensive tier runs behind it', async () => {
		const dir = setupTieredCoverageRepo();
		const config = await readConfig({ cwd: dir });
		const gates: GateResult[] = [];

		const { error } = await runGates({
			cwd: dir,
			config,
			coverage: true,
			failFast: false,
			schedule: { kind: GateScheduleKind.Tiered },
			onGateResult: (result) => gates.push(result),
		});

		expect(error).toBe(undefined);
		// tiering changes when a gate may start, never which gates a run schedules:
		// coverage still stands in for the plain unit suite, and the run is the same
		// four gates an untiered one produces
		expect(gates.map((gate) => gate.kind)).toStrictEqual(['check', 'testCoverage', 'test-e2e', 'build']);
		expect(readGateLog({ dir })).toStrictEqual(['root check', 'root coverage', 'root e2e', 'root build']);
	});

	test('a red expensive gate fails the checkpoint, and every other gate in its tier still runs', async () => {
		const dir = setupTieredCoverageRepo({ suite: redGate({ kind: 'e2e' }) });
		const config = await readConfig({ cwd: dir });

		const { error, failedFamilies } = await runGates({
			cwd: dir,
			config,
			coverage: true,
			failFast: false,
			schedule: { kind: GateScheduleKind.Tiered },
		});

		expect(failedFamilies).toStrictEqual(['test-e2e']);
		expect(error ?? '').toMatch(/test-e2e failed \(exit 1\)/);
		// only the tier boundary stops a run, and the expensive tier has no boundary
		// after it: the build ran behind the red suite, so one repair report carries
		// both halves of the checkpoint
		expect(readGateLog({ dir })).toStrictEqual(['root check', 'root coverage', 'root e2e', 'root build']);
	});

	test('a green cheap tier in every package starts the expensive tier in each of them', async () => {
		const dir = setupGreenTieredMonorepo();
		const config = await readConfig({ cwd: dir });

		const { error, failedFamilies } = await runGates({
			cwd: dir,
			config,
			packages: ['api', 'web'],
			failFast: false,
			schedule: { kind: GateScheduleKind.Tiered },
		});

		expect(error).toBe(undefined);
		expect(failedFamilies).toStrictEqual([]);

		const log = readGateLog({ dir });

		// the barrier is the claim, not the order inside it: the two package groups
		// run in parallel, so every cheap gate across both packages lands before any
		// expensive one, and nothing beyond that is promised
		expect(log.slice(0, 4).sort()).toStrictEqual(['@acme/api check', '@acme/api test', '@acme/web check', '@acme/web test']);
		expect(log.slice(4).sort()).toStrictEqual(['@acme/api build', '@acme/api e2e', '@acme/web build', '@acme/web e2e']);
	});

	test('the held tier is narrated as a crash when the red gate named no family', async () => {
		const dir = setupTieredCoverageRepo({ unit: crashingGate });
		const config = await readConfig({ cwd: dir });
		const progress: string[] = [];

		const { crashes } = await runGates({
			cwd: dir,
			config,
			failFast: false,
			schedule: { kind: GateScheduleKind.Tiered },
			onProgress: (message) => progress.push(message),
		});

		expect(crashes).toHaveLength(1);

		const held = progress.filter((message) => /expensive gates not started/.test(message));

		// a crash is red without naming a family to repair, so the line that says
		// why a suite stopped appearing has nothing to list — it says so rather
		// than reading as an empty pair of brackets
		expect(held).toHaveLength(1);
		expect(held[0] ?? '').toContain('(crash)');
	});
});
