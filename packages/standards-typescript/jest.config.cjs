const createJestConfig = require('../../tooling/jest/createJestConfig.cjs');

// This package's own suite: the co-located tests beside each rule's check, and
// the ones beside the helpers those checks share.
//
// rootDir is the package, which is the whole point — a standards package is
// testable on its own, by whoever wrote it, without the engine's repo around it.
// It also puts the committed build copy at plugin/standards/ outside the project
// entirely, so the duplicate-collection hazard the single root config had to warn
// about cannot arise here.
//
// The 95% threshold arrived as its own piece of work, exactly as the note that
// used to live here promised: the package started at ~84% with a third of its
// checks untested, and `lightsout test-coverage-to-threshold` was pointed at
// the gap rather than a human writing the tests by hand.
module.exports = createJestConfig({
	rootDir: __dirname,
	testMatch: ['<rootDir>/**/*.unit.test.ts'],
	coverageThreshold: { global: { statements: 95, branches: 95, functions: 95, lines: 95 } },
	// Measure every check and every shared helper, not just the ones a test
	// happens to import — a rule whose check has no test at all should score zero
	// and drag the number down, which is the gap this gate exists to catch.
	//
	// Fixtures are excluded because they are not this package's code: they are
	// deliberately shaped example files a check READS, and the failing side is
	// written to violate the very rule it proves.
	collectCoverageFrom: ['**/*.ts', '!**/*.unit.test.ts', '!**/fixtures/**'],
});
