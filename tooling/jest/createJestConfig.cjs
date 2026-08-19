const { join } = require('node:path');

const toolingDir = __dirname;

/**
 * The Jest settings every package in this workspace shares.
 *
 * A factory rather than a `preset`, because Jest merges a preset by rules that
 * are easy to get wrong — the config this replaced had to re-declare the ts-jest
 * preset's own `^.+\.tsx?$` key just to reach the compiler. A function composes
 * by plain object spread, where what wins is visible on the page.
 *
 * Type checking is off: each package's tsconfig.jest.json inherits
 * `isolatedModules: true`, and in ts-jest that is what makes it transpile-only.
 * `pnpm typecheck` is the type gate.
 *
 * @param rootDir - the package root; every glob in the returned config anchors to it
 */
module.exports = ({ rootDir, ...rest }) => ({
	rootDir,
	preset: 'ts-jest',
	testEnvironment: 'node',
	clearMocks: true,
	restoreMocks: true,
	testTimeout: 30_000,
	// json-summary is what `lightsout test-coverage-to-threshold` (and doctor)
	// read to pick the worst files — every package emits it, not just the one
	// that happened to declare it first.
	coverageReporters: ['text', 'lcov', 'json-summary'],
	// A rule's fixtures are deliberately shaped test files a check reads as TEXT —
	// the failing side is meant to violate the very rule it proves. Running them
	// would report a package's counter-examples as this repo's own test failures.
	// Restating node_modules is required: naming this key replaces Jest's default.
	testPathIgnorePatterns: ['/node_modules/', '/fixtures/'],
	setupFilesAfterEnv: [join(toolingDir, 'setupTestEnvironment.ts')],
	transform: {
		// Re-declares the key the ts-jest preset supplies — that is how each
		// package's own tsconfig.jest.json reaches the compiler, since Jest merges
		// preset and config transforms with the config's key winning.
		'^.+\\.tsx?$': ['ts-jest', { tsconfig: join(rootDir, 'tsconfig.jest.json') }],
		// The runtime half of markdown.d.ts: the engine imports its prompts as
		// strings, which works in the bundle only because of esbuild's text loader.
		'^.+\\.md$': join(toolingDir, 'markdownTransformer.cjs'),
	},
	...rest,
});
