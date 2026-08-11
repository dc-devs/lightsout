const createJestConfig = require('../../tooling/jest/createJestConfig.cjs');

// The engine's own unit suite: the co-located tests under src/.
//
// The standards packages and the two shared packages each run their own suite
// now, so this config no longer reaches outside the engine — and the committed
// build copy at plugin/standards/ is outside every project, so the duplicate
// collection the old root config had to guard against cannot happen.
module.exports = createJestConfig({
	rootDir: __dirname,
	testMatch: ['<rootDir>/src/**/*.unit.test.ts'],
	// Measure EVERY source file, not just the ones a test happens to import.
	// Jest's default only instruments files reached by a test, so a module with
	// no test at all scores nothing and drags the average up rather than down —
	// which would make the threshold below report a clean number for exactly the
	// gap it exists to catch.
	collectCoverageFrom: ['src/**/*.ts', '!src/**/*.unit.test.ts', '!src/**/*.d.ts'],
	// json-summary is what `lightsout test-coverage-to-threshold` reads. The
	// default reporters never wrote it, so that command could not run here.
	coverageReporters: ['text', 'lcov', 'json-summary'],
	// The gate `pnpm test:unit:coverage` was once decorative: it printed a report
	// and always exited 0. These make it fail. Loosening any of them is an
	// explicit edit here, never a silent drift.
	coverageThreshold: { global: { statements: 95, branches: 95, functions: 95, lines: 95 } },
	moduleNameMapper: {
		'^@/(.*)$': '<rootDir>/src/$1',
		'^@tests/(.*)$': '<rootDir>/tests/$1',
	},
});
