const { availableParallelism } = require('node:os');
const { join } = require('node:path');

const toolingDir = __dirname;

/**
 * How many builds share this machine (`LIGHTSOUT_CONCURRENT_BUILDS`, default 1).
 * `lightsout queue` runs each build as its own process, and none can see the
 * others, so each takes its share of the worker ceiling below.
 */
const readConcurrentBuilds = () => {
	const raw = process.env.LIGHTSOUT_CONCURRENT_BUILDS;

	if (raw === undefined || raw.trim() === '') {
		return 1;
	}

	const parsed = Number(raw);

	if (!Number.isInteger(parsed) || parsed < 1) {
		throw new Error(`LIGHTSOUT_CONCURRENT_BUILDS must be a whole number of 1 or more, and is ${JSON.stringify(raw)}`);
	}

	return parsed;
};

/**
 * The Jest settings every package in this workspace shares. A factory rather
 * than a `preset`, so what overrides what is plain object spread.
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
	// At most eight, and fewer on small machines: a flat eight overloaded
	// four-core CI runners until slow tests hit the 30-second limit.
	maxWorkers: Math.max(1, Math.floor(Math.min(8, availableParallelism() - 1) / readConcurrentBuilds())),
	workerIdleMemoryLimit: '512MB',
	// json-summary is what `lightsout test-coverage-to-threshold` and `doctor` read.
	coverageReporters: ['text', 'lcov', 'json-summary'],
	// A package entry index.ts only re-exports, so no test loads it. Naming this
	// key, or testPathIgnorePatterns, replaces Jest's default, so node_modules is restated.
	coveragePathIgnorePatterns: ['/node_modules/', '/index\\.tsx?$'],
	// lightsout sets LIGHTSOUT_JEST_REPORTER on its gate commands to record which tests ran.
	reporters: process.env.LIGHTSOUT_JEST_REPORTER ? ['default', process.env.LIGHTSOUT_JEST_REPORTER] : ['default'],
	// A rule's fixtures are test files it reads as text, and are meant to fail.
	testPathIgnorePatterns: ['/node_modules/', '/fixtures/'],
	globalSetup: join(toolingDir, 'checkSparkplugOff.cjs'),
	setupFilesAfterEnv: [join(toolingDir, 'setupTestEnvironment.ts')],
	transform: {
		// Re-declared so each package's own tsconfig.jest.json reaches ts-jest.
		'^.+\\.tsx?$': ['ts-jest', { tsconfig: join(rootDir, 'tsconfig.jest.json') }],
		// The engine imports its prompts as strings, as esbuild's text loader does in the bundle.
		'^.+\\.md$': join(toolingDir, 'markdownTransformer.cjs'),
	},
	...rest,
});
