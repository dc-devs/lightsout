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
	// Measure EVERY source file, not just the ones a test happens to import.
	// Jest's default only instruments files reached by a test, so a module with
	// no test at all scores nothing and drags the average up rather than down —
	// which would make the threshold below report a clean number for exactly the
	// gap it exists to catch.
	collectCoverageFrom: ['src/**/*.ts', '!src/**/*.unit.test.ts', '!src/**/*.d.ts'],
	// The gate `pnpm test:unit:coverage` was previously decorative: it printed a
	// report and always exited 0. These make it fail. Branches is the tight one
	// — 1793/1887 covered at the time of writing, where 95% needs 1793, so the
	// next uncovered branch turns the gate red. That is the intent: loosening is
	// an explicit edit here, never a silent drift.
	coverageThreshold: {
		global: {
			statements: 95,
			branches: 95,
			functions: 95,
			lines: 95,
		},
	},
	moduleNameMapper: {
		'^@/(.*)$': '<rootDir>/src/$1',
		'^@tests/(.*)$': '<rootDir>/tests/$1',
	},
	transform: {
		'^.+\\.tsx?$': ['ts-jest', { tsconfig: '<rootDir>/tests/config/tsconfig.jest.json' }],
		'^.+\\.md$': '<rootDir>/tests/config/markdownTransformer.cjs',
	},
};
