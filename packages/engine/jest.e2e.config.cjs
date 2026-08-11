const createJestConfig = require('../../tooling/jest/createJestConfig.cjs');

// The subprocess suite: the tests that run the built CLI, and the ones that ask
// whether what ships matches what source builds to. Separate from the unit
// config for one reason — the globalSetup below builds a bundle, and that cost
// must not be charged to every unit run.
//
// These reach outside the package on purpose: plugin/ is a repo-level artifact
// built from two projects. Each such test anchors its own paths on __dirname.
module.exports = createJestConfig({
	rootDir: __dirname,
	testMatch: ['<rootDir>/tests/**/*.test.ts'],
	globalSetup: '<rootDir>/tests/config/buildCliUnderTest.cjs',
	moduleNameMapper: {
		'^@/(.*)$': '<rootDir>/src/$1',
		'^@tests/(.*)$': '<rootDir>/tests/$1',
	},
});
