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

interface TieredCoverageRepoParams {
	/** Replaces the green, logging unit-test gate. */
	unit?: string;
	/** Replaces the green, logging coverage gate. */
	coverageGate?: string;
	/** Replaces the green, logging custom-suite gate. */
	suite?: string;
}

/** A single-package repo with every gate kind, each logging "root <kind>" to gates.log. */
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

/** Two packages, every scoped gate green. No template has a `run <script>` token, so none is skipped. */
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

		// the package groups run in parallel, so only the tier barrier is asserted, not order
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

		expect(held).toHaveLength(1);
		expect(held[0] ?? '').toContain('(crash)');
	});
});
