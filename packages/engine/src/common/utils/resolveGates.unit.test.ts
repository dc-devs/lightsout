import { describe, expect, test } from '@jest/globals';
import { resolveGates } from '@/common/utils/resolveGates';

describe('resolveGates', () => {
	test('reads the kebab block into the engine spelling, custom suites in written order', () => {
		const resolved = resolveGates({
			gates: {
				check: 'pnpm check',
				test: 'pnpm test:unit',
				'test-coverage': 'pnpm test:unit:coverage',
				'test-e2e': 'pnpm test:e2e',
				'test-integration': 'pnpm test:int',
				build: 'pnpm bundle',
			},
		});

		expect(resolved).toStrictEqual({
			check: 'pnpm check',
			test: 'pnpm test:unit',
			testCoverage: 'pnpm test:unit:coverage',
			build: 'pnpm bundle',
			// written order, because the config's order is the run order
			extraTests: [
				{ name: 'test-e2e', command: 'pnpm test:e2e' },
				{ name: 'test-integration', command: 'pnpm test:int' },
			],
		});
	});

	test('a minimal block resolves with no custom suites and the coverage opt-out intact', () => {
		const resolved = resolveGates({ gates: { check: 'c', test: 't', 'test-coverage': false } });

		expect(resolved).toStrictEqual({ check: 'c', test: 't', testCoverage: false, extraTests: [] });
	});
});
