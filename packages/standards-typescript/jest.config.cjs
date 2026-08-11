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
// No coverage threshold yet, deliberately.
//
// Until this became a package of its own, its tests ran inside the engine's
// suite and its coverage was collected and then thrown away — so nothing in the
// repo had ever measured it. Measured now, over every check and helper rather
// than only the files a test imports: 84 statements, 90 branches, 82 functions,
// 84 lines. Roughly a third of the checks ship no unit test of their own.
//
// Writing 95 here would leave the gate red on arrival; writing 84 would be a
// debt baseline, which this repo does not do. So the number is printed on every
// run and gated by nothing, until someone raises it to 95 as its own piece of
// work. `lightsout test-coverage-to-threshold` is built for exactly that.
module.exports = createJestConfig({
	rootDir: __dirname,
	testMatch: ['<rootDir>/**/*.unit.test.ts'],
	// Measure every check and every shared helper, not just the ones a test
	// happens to import — a rule whose check has no test at all should score zero
	// and drag the number down, which is the gap this gate exists to catch.
	//
	// Fixtures are excluded because they are not this package's code: they are
	// deliberately shaped example files a check READS, and the failing side is
	// written to violate the very rule it proves.
	collectCoverageFrom: ['**/*.ts', '!**/*.unit.test.ts', '!**/fixtures/**'],
});
