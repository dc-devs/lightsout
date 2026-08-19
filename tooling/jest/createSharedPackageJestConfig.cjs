const createJestConfig = require('./createJestConfig.cjs');

/**
 * The Jest settings the two shared packages — standards-contracts and
 * standards-testkit — have in common. They are the same package shape: a small
 * `src/` of co-located unit tests, and no fixtures to keep out of the coverage
 * denominator.
 *
 * They are also what everything else builds against, so they carry the same
 * coverage bar as the engine. A small denominator makes a percentage move
 * sharply — one uncovered branch out of a handful reads as a big drop — which
 * is a reason to read a dip carefully, not a reason to set it lower.
 *
 * @param rootDir - the package root; every glob in the returned config anchors to it
 */
module.exports = ({ rootDir }) =>
	createJestConfig({
		rootDir,
		testMatch: ['<rootDir>/src/**/*.unit.test.ts'],
		collectCoverageFrom: ['src/**/*.ts', '!src/**/*.unit.test.ts'],
		coverageThreshold: { global: { statements: 95, branches: 95, functions: 95, lines: 95 } },
	});
