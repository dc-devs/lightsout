import { describe, expect, test } from '@jest/globals';
import { resolvePackageGatesConfig } from '#src/common/utils/resolvePackageGatesConfig.ts';
import type { PackageGates } from '#src/contracts/index.ts';

describe('resolvePackageGatesConfig', () => {
	test('reads the kebab block into the engine spelling, custom suite templates in written order', () => {
		const resolved = resolvePackageGatesConfig({
			packageGates: {
				check: 'c {package}',
				test: 't {package}',
				'test-coverage': 'cov {package}',
				'test-e2e': 'e2e {package}',
				build: 'b {package}',
			},
		});

		expect(resolved).toStrictEqual({
			check: 'c {package}',
			test: 't {package}',
			testCoverage: 'cov {package}',
			build: 'b {package}',
			extraTests: [{ name: 'test-e2e', command: 'e2e {package}' }],
		});
	});

	test('a minimal block resolves with no custom suites and no coverage template', () => {
		expect(resolvePackageGatesConfig({ packageGates: { check: 'c {package}', test: 't {package}' } })).toStrictEqual({
			check: 'c {package}',
			test: 't {package}',
			extraTests: [],
		});
	});

	test('a custom key carrying something other than a command template is not read as a suite to run', () => {
		const resolved = resolvePackageGatesConfig({
			packageGates: { check: 'c {package}', test: 't {package}', 'test-e2e': 7 } as unknown as PackageGates,
		});

		// the block's catch-all lets any key through, and a suite the engine cannot
		// spawn must not reach the gate runner as one
		expect(resolved).toStrictEqual({ check: 'c {package}', test: 't {package}', extraTests: [] });
	});
});
