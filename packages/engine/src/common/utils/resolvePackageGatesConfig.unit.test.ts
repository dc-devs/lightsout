import { describe, expect, test } from '@jest/globals';
import { resolvePackageGatesConfig } from '@/common/utils/resolvePackageGatesConfig';

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
});
