// The unit config: the co-located src/**/*.unit.test.ts files.
//
// rootDir is the repo root (not src/) because Jest resolves it relative to this
// file, and because src/standards/defaultCodeStandards.ts imports .md docs via
// relative ../../standards/ paths that must stay inside the project.
//
// The transform re-declares the ^.+\.tsx?$ key the ts-jest preset supplies —
// that is how the tsconfig.jest.json override reaches the compiler, since Jest
// merges preset and config transforms with the config's key winning. Type
// checking is off: tsconfig.jest.json extends the root config, which sets
// isolatedModules: true, and in ts-jest 29 that is what makes it transpile-only.
// `pnpm check` is the type gate.
module.exports = {
	rootDir: '../..',
	preset: 'ts-jest',
	testEnvironment: 'node',
	clearMocks: true,
	restoreMocks: true,
	testTimeout: 30_000,
	testMatch: ['<rootDir>/src/**/*.unit.test.ts'],
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
