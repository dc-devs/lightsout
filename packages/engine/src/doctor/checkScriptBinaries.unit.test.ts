import { describe, expect, test } from '@jest/globals';
import type { LightsoutConfig } from '#src/contracts/index.ts';
import { checkScriptBinaries } from '#src/doctor/checkScriptBinaries.ts';
import { setupConsumerRepo } from '#tests/helpers/setupConsumerRepo.ts';

const configWith = (gates: Partial<LightsoutConfig['gates']>): LightsoutConfig => ({
	gates: { check: 'true', test: 'true', 'test-coverage': false, ...gates },
});

describe('checkScriptBinaries', () => {
	test('passes when every gate command starts with a binary on PATH', async () => {
		const cwd = setupConsumerRepo();

		const check = await checkScriptBinaries({ cwd, config: configWith({}) });

		expect(check.status).toBe('pass');
		expect(check.detail).toMatch(/gate commands resolve/);
	});

	test('fails and names a binary that is not installed, because every gate depends on it', async () => {
		const cwd = setupConsumerRepo();

		const check = await checkScriptBinaries({ cwd, config: configWith({ check: 'lightsout-not-a-real-binary --all' }) });

		expect(check.status).toBe('fail');
		expect(check.detail).toMatch(/not on PATH: lightsout-not-a-real-binary/);
	});

	test('probes the scoped package commands too, not just the root ones', async () => {
		const cwd = setupConsumerRepo();
		const config: LightsoutConfig = {
			...configWith({}),
			'package-gates': { check: 'lightsout-absent-runner --filter {package}', test: 'true {package}' },
		};

		const check = await checkScriptBinaries({ cwd, config });

		expect(check.detail).toMatch(/lightsout-absent-runner/);
	});

	test('names each distinct binary once across the root and scoped gate commands', async () => {
		const cwd = setupConsumerRepo();
		const config: LightsoutConfig = {
			...configWith({}),
			'package-gates': { check: 'true --filter {package}', test: 'node --version {package}' },
		};

		const check = await checkScriptBinaries({ cwd, config });

		expect(check.status).toBe('pass');
		// both blocks feed one probe list, and the binary the root and scoped
		// commands share is probed once, not twice
		expect(check.detail).toMatch(/\(true, node\)/);
	});

	test('a directory that does not exist reports the binaries as unresolvable rather than crashing', async () => {
		// the probe cannot even be spawned there, which is a failure to resolve
		const check = await checkScriptBinaries({ cwd: '/lightsout/no/such/directory', config: configWith({}) });

		expect(check.status).toBe('fail');
	});
});
