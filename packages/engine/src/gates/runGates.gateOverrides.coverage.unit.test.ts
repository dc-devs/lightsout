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

/** A single-package consumer whose unit and coverage gates both log "root <kind>". */
const setupRootRepo = () =>
	setupConsumerRepo({
		scripts: {
			check: `${gateLogCommand({ kind: 'check' })} root`,
			test: `${gateLogCommand({ kind: 'test' })} root`,
			'test-coverage': `${gateLogCommand({ kind: 'coverage' })} root`,
		},
	});

/**
 * A monorepo whose one package defines the check and unit-test gate scripts but
 * not the coverage one, so the coverage template is script-detected as absent
 * and skipped.
 */
const setupCoveragelessPackageRepo = () => {
	const dir = mkdtempSync(join(tmpdir(), 'lightsout-override-fallback-'));

	mkdirSync(join(dir, 'packages', 'semi'), { recursive: true });
	writeFileSync(
		join(dir, 'packages', 'semi', 'package.json'),
		JSON.stringify({ name: '@acme/semi', scripts: { 'gate:check': 'unused', 'gate:test': 'unused' } }),
	);

	writeFileSync(
		join(dir, 'lightsout.config.json'),
		JSON.stringify({
			gates: { check: 'true', test: 'true', 'test-coverage': false },
			'package-gates': {
				check: `${gateLogCommand({ kind: 'check' })} {package} run gate:check`,
				test: `${gateLogCommand({ kind: 'test' })} {package} run gate:test`,
				'test-coverage': `${gateLogCommand({ kind: 'coverage' })} {package} run gate:coverage`,
			},
		}),
	);

	return dir;
};

describe('runGates', () => {
	test('an override list gets no coverage fallback — the missing suite is skipped, not stood in for', async () => {
		const dir = setupCoveragelessPackageRepo();
		const config = await readConfig({ cwd: dir });
		const progress: string[] = [];

		const { error, failedFamilies } = await runGates({
			cwd: dir,
			config,
			packages: ['semi'],
			coverage: true,
			schedule: { kind: GateScheduleKind.Exact, gates: ['test-coverage', 'check'] },
			onProgress: (message) => progress.push(message),
		});

		expect(error).toBe(undefined);
		expect(failedFamilies).toStrictEqual([]);
		expect(progress.includes('gate [semi] testCoverage: skipped (no "gate:coverage" script)')).toBeTruthy();
		// under the default schedule this package's missing coverage script falls
		// back to its plain unit suite; an override runs exactly the gates it names,
		// so substituting one the author never wrote would contradict the list
		expect(readGateLog({ dir })).toStrictEqual(['@acme/semi check']);
	});

	test('an override naming both the unit suite and coverage runs both — neither replaces the other', async () => {
		const dir = setupRootRepo();
		const config = await readConfig({ cwd: dir });
		const gates: GateResult[] = [];

		const { error } = await runGates({
			cwd: dir,
			config,
			coverage: true,
			schedule: { kind: GateScheduleKind.Exact, gates: ['test', 'test-coverage'] },
			onGateResult: (result) => gates.push(result),
		});

		expect(error).toBe(undefined);
		// the coverage-replaces-test substitution belongs to the default schedule:
		// a list that names both asked for both, and the engine's own choice about
		// which suite to run is exactly what the list replaced
		expect(gates.map((gate) => gate.kind)).toStrictEqual(['test', 'testCoverage']);
		expect(readGateLog({ dir })).toStrictEqual(['root test', 'root coverage']);
	});
});
