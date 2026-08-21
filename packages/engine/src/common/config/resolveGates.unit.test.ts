import { describe, expect, test } from '@jest/globals';
import { resolveGates } from '#src/common/config/resolveGates.ts';
import type { ConfigGates } from '#src/contracts/index.ts';

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

	test('the optional gates are carried through only when the config wrote them', () => {
		const resolved = resolveGates({
			gates: { check: 'c', test: 't', 'test-coverage': 'cov', generate: 'pnpm codegen', build: 'pnpm bundle', format: 'pnpm format' },
		});

		expect(resolved).toStrictEqual({
			check: 'c',
			test: 't',
			testCoverage: 'cov',
			generate: 'pnpm codegen',
			build: 'pnpm bundle',
			format: 'pnpm format',
			extraTests: [],
		});
	});

	test('a minimal block resolves with no custom suites and the coverage opt-out intact', () => {
		const resolved = resolveGates({ gates: { check: 'c', test: 't', 'test-coverage': false } });

		expect(resolved).toStrictEqual({ check: 'c', test: 't', testCoverage: false, extraTests: [] });
	});

	test('a custom key carrying something other than a command is not read as a suite to run', () => {
		const resolved = resolveGates({ gates: { check: 'c', test: 't', 'test-coverage': 'cov', 'test-e2e': 7 } as unknown as ConfigGates });

		// the block's catch-all lets any key through, and a suite the engine cannot
		// spawn must not reach the gate runner as one
		expect(resolved).toStrictEqual({ check: 'c', test: 't', testCoverage: 'cov', extraTests: [] });
	});
});
