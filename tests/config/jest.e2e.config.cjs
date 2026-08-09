// The subprocess config: tests/cli.test.ts and tests/standardsPackageLoading.test.ts.
// Identical to the unit config except for testMatch and the globalSetup that
// builds the CLI bundle — the one cost that must not be charged to the unit
// suite. testMatch cannot collide with the unit config: nothing under
// tests/config/ or tests/helpers/ carries a `.test.` segment.
module.exports = {
	rootDir: '../..',
	preset: 'ts-jest',
	testEnvironment: 'node',
	clearMocks: true,
	restoreMocks: true,
	testTimeout: 30_000,
	testMatch: ['<rootDir>/tests/**/*.test.ts'],
	globalSetup: '<rootDir>/tests/config/buildCliUnderTest.cjs',
	setupFilesAfterEnv: ['<rootDir>/tests/config/setupTestEnvironment.ts'],
	moduleNameMapper: {
		'^@/(.*)$': '<rootDir>/src/$1',
		'^@tests/(.*)$': '<rootDir>/tests/$1',
	},
	transform: {
		'^.+\\.tsx?$': ['ts-jest', { tsconfig: '<rootDir>/tests/config/tsconfig.jest.json' }],
		'^.+\\.md$': '<rootDir>/tests/config/markdownTransformer.cjs',
	},
};
