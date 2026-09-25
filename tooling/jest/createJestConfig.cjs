const { availableParallelism } = require('node:os');
const { join } = require('node:path');

const toolingDir = __dirname;

/**
 * How many builds share this machine, read from `LIGHTSOUT_CONCURRENT_BUILDS`.
 *
 * One unless that variable says otherwise. The worker ceiling below is a whole
 * machine's budget, and nx.json keeps a single run inside it by running the
 * test targets one at a time. That guard reaches only as far as one Nx process:
 * `lightsout queue` builds each ticket in its own worktree as its own process,
 * and neither can see the other, so two builds put two full pools on one
 * machine — the sixteen-workers-on-fourteen-cores case nx.json measured at 12
 * crashed runs in 39. Nothing in the process can discover how many siblings it
 * has, so whoever starts them says, and each pool takes its share.
 *
 * A value that is present but unusable throws rather than quietly falling back
 * to one: a typo would otherwise leave every pool at full width while the
 * person who set it believes the machine is capped.
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
 * `globalSetup` refuses to start on a Node version measured to crash this suite
 * often; checkNodeVersion.cjs holds the versions and the evidence, including
 * why a rare lone SIGSEGV on a permitted version is still that bug rather than
 * a test. A config that needs its own globalSetup — the e2e one builds a
 * bundle — calls that check itself, so neither path skips it.
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
	// A ceiling of eight workers, or one per core minus one where the machine has
	// fewer cores than that — whichever is smaller.
	//
	// Nothing bounded this before, and two layers multiplied: Nx runs several
	// projects at once and each asked Jest for 13 workers on a 14-core machine, so
	// one `pnpm test:unit` could start 39 worker processes. That matters because
	// the known Jest worker segfault gets more likely the more workers there are:
	// the crash happens during a major garbage collection, and more workers means
	// more heap and more collections. Measured on 2026-09-04, two suites running
	// at once: 26 workers lost 2 runs in 24, 20 lost 1, and 8 lost none, against
	// 30 clean runs on an idle machine at 13.
	//
	// Eight is the point where the cost is about two seconds a run rather than the
	// twenty-eight a tighter cap costs, and what slips through is the case LO-39's
	// gate retry was built to absorb. It has to be a ceiling rather than a flat
	// number, because the machines differ by an order of magnitude: a 14-core
	// laptop hosting several agents has the cores to spend, while a four-core CI
	// runner does not. A flat eight there oversubscribed the runner badly enough
	// that the slowest suites passed the thirty-second per-test limit and failed.
	//
	// Eight is the whole machine's count for ONE test run, not one of several:
	// nx.json runs the test targets one at a time, because two pools of eight side
	// by side crashed far more often than one. Several runs at once are outside
	// what Nx can serialise, so the ceiling is divided by the number of builds
	// sharing the machine — see `readConcurrentBuilds` above. A run that says
	// nothing is the only run, and keeps the full eight.
	maxWorkers: Math.max(1, Math.floor(Math.min(8, availableParallelism() - 1) / readConcurrentBuilds())),
	// Recycle a worker once it passes this, rather than letting it carry a heap
	// from one test file to the next for the whole run.
	//
	// The known Jest worker crash happens inside V8's major garbage collection, so
	// how often it fires tracks how often that collection runs — and it runs when
	// a heap has grown large. A worker that is replaced before it gets there does
	// the same work having collected less. Unlike the worker cap above this costs
	// no parallelism: it only restarts workers that were about to become expensive.
	workerIdleMemoryLimit: '512MB',
	// json-summary is what `lightsout test-coverage-to-threshold` (and doctor)
	// read to pick the worst files — every package emits it, not just the one
	// that happened to declare it first.
	coverageReporters: ['text', 'lcov', 'json-summary'],
	// An index.ts holds only re-export lines — the code-in-index-file standard
	// keeps logic out of it — and every import names the file that declares
	// what it imports, so no test loads one. Counting them would score each
	// re-exported name as an uncovered function with no tested code behind it.
	// Restating node_modules is required: naming this key replaces Jest's default.
	coveragePathIgnorePatterns: ['/node_modules/', '/index\\.tsx?$'],
	// lightsout names a reporter file on LIGHTSOUT_JEST_REPORTER when it runs a
	// gate command, and that reporter records which cases each jest process
	// actually ran — the evidence a plan's acceptance tests are proven by. The
	// entry is conditional so an ordinary developer run, where the variable is
	// unset, gets jest's default reporter and nothing else. Restating 'default'
	// is required: naming this key replaces jest's default, the same gotcha
	// testPathIgnorePatterns documents below.
	reporters: process.env.LIGHTSOUT_JEST_REPORTER ? ['default', process.env.LIGHTSOUT_JEST_REPORTER] : ['default'],
	// A rule's fixtures are deliberately shaped test files a check reads as TEXT —
	// the failing side is meant to violate the very rule it proves. Running them
	// would report a package's counter-examples as this repo's own test failures.
	// Restating node_modules is required: naming this key replaces Jest's default.
	testPathIgnorePatterns: ['/node_modules/', '/fixtures/'],
	globalSetup: join(toolingDir, 'checkNodeVersion.cjs'),
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
