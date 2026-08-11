const createJestConfig = require('../../tooling/jest/createJestConfig.cjs');

module.exports = createJestConfig({
	rootDir: __dirname,
	testMatch: ['<rootDir>/src/**/*.unit.test.ts'],
	collectCoverageFrom: ['src/**/*.ts', '!src/**/*.unit.test.ts'],
	// This package is small and is what everything else builds against, so it
	// carries the same bar as the engine. A small denominator makes a percentage
	// move sharply — one uncovered branch out of a handful reads as a big drop —
	// which is a reason to read a dip carefully, not a reason to set it lower.
	coverageThreshold: { global: { statements: 95, branches: 95, functions: 95, lines: 95 } },
});
