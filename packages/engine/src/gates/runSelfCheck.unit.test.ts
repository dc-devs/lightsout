import { execSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, test } from '@jest/globals';
import { readConfig } from '#src/common/config/readConfig.ts';
import { runSelfCheck } from '#src/gates/index.ts';
import { gateLogCommand } from '#tests/helpers/gateLogCommand.ts';
import { readGateLog } from '#tests/helpers/readGateLog.ts';

/** A root-block gate command that logs "root <kind>" — which gates ran is read off gates.log. */
const rootGate = ({ kind }: { kind: string }) => `${gateLogCommand({ kind })} root`;

/** A scoped template that logs "<package name> <kind>", so package scope is readable off the same log. */
const packageGate = ({ kind }: { kind: string }) => `${gateLogCommand({ kind })} {package}`;

const defaultGates: Record<string, string | false> = {
	check: rootGate({ kind: 'check' }),
	test: rootGate({ kind: 'test' }),
	'test-coverage': rootGate({ kind: 'coverage' }),
	build: rootGate({ kind: 'build' }),
	'test-e2e': rootGate({ kind: 'e2e' }),
};

const defaultPackageGates: Record<string, string> = {
	check: packageGate({ kind: 'check' }),
	test: packageGate({ kind: 'test' }),
	'test-coverage': packageGate({ kind: 'coverage' }),
	build: packageGate({ kind: 'build' }),
	'test-e2e': packageGate({ kind: 'e2e' }),
};

interface SetupParams {
	/** The root `gates` block this repo configures. */
	gates?: Record<string, string | false>;
	/** The scoped `package-gates` block, or null for a repo that configures no scoped block at all. */
	packageGates?: Record<string, string> | null;
	/** A `gate-overrides` block, keyed by checkpoint. */
	overrides?: Record<string, unknown>;
	/** The `scripts` every package's package.json declares — `{}` makes every `run <script>` template a skip. */
	scripts?: Record<string, string>;
	/** Files dirtied AFTER the initial commit — this is the live diff the scope is read from. */
	changed?: string[];
	/** false removes the worktree, which is how `git status` becomes unreadable. */
	git?: boolean;
}

/**
 * A two-package monorepo whose gate commands log what ran, committed clean and
 * then dirtied — so the live git diff at call time is exactly `changed`.
 * gates.log is ignored so a gate's own writing never reads back as a
 * root-level change.
 */
const setupSelfCheck = async ({
	gates = defaultGates,
	packageGates = defaultPackageGates,
	overrides,
	scripts,
	changed = ['packages/api/src/added.js'],
	git = true,
}: SetupParams = {}) => {
	const dir = mkdtempSync(join(tmpdir(), 'lightsout-self-check-'));

	for (const packageDir of ['api', 'web']) {
		mkdirSync(join(dir, 'packages', packageDir, 'src'), { recursive: true });
		writeFileSync(join(dir, 'packages', packageDir, 'package.json'), JSON.stringify({ name: `@acme/${packageDir}`, ...(scripts ? { scripts } : {}) }));
		writeFileSync(join(dir, 'packages', packageDir, 'src', 'index.js'), 'export const one = 1;\n');
	}

	writeFileSync(join(dir, '.gitignore'), 'gates.log\n');
	writeFileSync(
		join(dir, 'lightsout.config.json'),
		JSON.stringify({
			gates,
			...(packageGates === null ? {} : { 'package-gates': packageGates }),
			...(overrides === undefined ? {} : { 'gate-overrides': overrides }),
		}),
	);
	execSync('git init -q && git add -A && git -c user.name=t -c user.email=t@t commit -qm init', { cwd: dir });

	for (const file of changed) {
		writeFileSync(join(dir, file), 'export const written = 1;\n');
	}

	if (!git) {
		rmSync(join(dir, '.git'), { recursive: true, force: true });
	}

	return {
		dir,
		config: await readConfig({ cwd: dir }),
		log: () => readGateLog({ dir }),
		records: ({ runId }: { runId: string }) =>
			readFileSync(join(dir, '.lightsout', 'runs', runId, 'commands.jsonl'), 'utf8')
				.trim()
				.split('\n')
				.map((line) => JSON.parse(line) as Record<string, unknown>),
	};
};

describe('runSelfCheck', () => {
	test("runSelfCheck: runs the checkpoint's cheap gates and the build, scoped to the packages the live diff touched", async () => {
		const { dir, config, log } = await setupSelfCheck();

		const result = await runSelfCheck({
			cwd: dir,
			config,
			coverage: false,
			checkpoint: 'verify-implement',
			wholeRepository: false,
			runId: 'run-1',
			step: 'implement',
			onProgress: () => undefined,
		});

		expect(result.reason).toBe('ran');
		expect(result.error).toBe(undefined);
		// the checkpoint's cheap tier, plus the build — the expensive suite is what a
		// spawn must never wait on
		expect(result.gateNames).toStrictEqual(['check', 'test', 'build']);
		// only the touched package ran: the untouched one and the whole-repo scripts
		// are absent from ${log().join(', ')}
		expect(log()).toStrictEqual(['@acme/api check', '@acme/api test', '@acme/api build']);
	});

	test('runSelfCheck: drops every custom test-* suite, so a spawn never waits on an end-to-end run', async () => {
		const { dir, config, log } = await setupSelfCheck({
			gates: { ...defaultGates, 'test-browser': rootGate({ kind: 'browser' }) },
			packageGates: { ...defaultPackageGates, 'test-browser': packageGate({ kind: 'browser' }) },
		});

		const result = await runSelfCheck({
			cwd: dir,
			config,
			coverage: false,
			checkpoint: 'verify-implement',
			wholeRepository: false,
			runId: 'run-1',
			step: 'implement',
			onProgress: () => undefined,
		});

		// both custom suites fall out — every one of them is expensive, and neither
		// is the build
		expect(result.gateNames).toStrictEqual(['check', 'test', 'build']);
		expect(log()).toStrictEqual(['@acme/api check', '@acme/api test', '@acme/api build']);
	});

	test('runSelfCheck: takes the cheap subset of a pinned gate list, plus the build when that list names it', async () => {
		const { dir, config, log } = await setupSelfCheck({ overrides: { 'verify-implement': ['check', 'test', 'test-e2e', 'build'] } });

		const result = await runSelfCheck({
			cwd: dir,
			config,
			coverage: false,
			checkpoint: 'verify-implement',
			wholeRepository: false,
			runId: 'run-1',
			step: 'implement',
			onProgress: () => undefined,
		});

		// the pinned list still decides which gates exist; the cheap/build filter
		// decides which of them a self-check spends
		expect(result.gateNames).toStrictEqual(['check', 'test', 'build']);
		expect(log()).toStrictEqual(['@acme/api check', '@acme/api test', '@acme/api build']);
	});

	test('runSelfCheck: reports an empty gate list for a checkpoint that is off, and never calls the gate runner', async () => {
		const { dir, config, log } = await setupSelfCheck({
			// the codegen command runs before any gate under every schedule but off, so
			// its absence from the log is what proves the gate runner was never called
			gates: { ...defaultGates, generate: rootGate({ kind: 'generate' }) },
			overrides: { 'verify-implement': 'off' },
		});

		const result = await runSelfCheck({
			cwd: dir,
			config,
			coverage: false,
			checkpoint: 'verify-implement',
			wholeRepository: false,
			runId: 'run-1',
			step: 'implement',
			onProgress: () => undefined,
		});

		expect(result.reason).toBe('nothing-scheduled');
		expect(result.gateNames).toStrictEqual([]);
		// an off checkpoint is not a green one — and it is not an error either
		expect(result.error).toBe(undefined);
		expect(log()).toStrictEqual([]);
	});

	test('runSelfCheck: records its executions under a self-check step name of its own', async () => {
		const { dir, config, records } = await setupSelfCheck();

		await runSelfCheck({
			cwd: dir,
			config,
			coverage: false,
			checkpoint: 'verify-implement',
			wholeRepository: false,
			runId: 'run-evidence',
			step: 'implement',
			onProgress: () => undefined,
		});

		// a self-check execution recorded under the step itself would land in the
		// checkpoint's own evidence namespace, where the following gate reads it
		expect(records({ runId: 'run-evidence' }).map((record) => record.step)).toStrictEqual([
			'self-check-implement',
			'self-check-implement',
			'self-check-implement',
		]);
	});

	test('runSelfCheck: schedules a build declared only by package-gates, which root-only names would miss', async () => {
		const { dir, config, log } = await setupSelfCheck({
			gates: { check: rootGate({ kind: 'check' }), test: rootGate({ kind: 'test' }), 'test-coverage': false },
			packageGates: { check: packageGate({ kind: 'check' }), test: packageGate({ kind: 'test' }), build: packageGate({ kind: 'build' }) },
		});

		const result = await runSelfCheck({
			cwd: dir,
			config,
			coverage: false,
			checkpoint: 'verify-implement',
			wholeRepository: false,
			runId: 'run-1',
			step: 'implement',
			onProgress: () => undefined,
		});

		// names read off the root block alone would never schedule this build
		expect(result.gateNames).toStrictEqual(['check', 'test', 'build']);
		expect(log()).toStrictEqual(['@acme/api check', '@acme/api test', '@acme/api build']);
	});

	test('runSelfCheck: keeps coverage out at the implement step even when a pinned gate list names it', async () => {
		const { dir, config, log } = await setupSelfCheck({ overrides: { 'verify-implement': ['check', 'test-coverage'] } });

		const result = await runSelfCheck({
			cwd: dir,
			config,
			coverage: false,
			checkpoint: 'verify-implement',
			wholeRepository: false,
			runId: 'run-1',
			step: 'implement',
			onProgress: () => undefined,
		});

		// at implement the freshly written source has no tests yet, so coverage is
		// red by construction and the executor is not the role that fixes it
		expect(result.gateNames).toStrictEqual(['check']);
		expect(log()).toStrictEqual(['@acme/api check']);
	});

	test('runSelfCheck: ends on an unchanged tree and on an unreadable git status without widening to the whole repository', async () => {
		const unchanged = await setupSelfCheck({ changed: [] });
		const unreadable = await setupSelfCheck({ git: false });

		const onUnchangedTree = await runSelfCheck({
			cwd: unchanged.dir,
			config: unchanged.config,
			coverage: false,
			checkpoint: 'verify-implement',
			wholeRepository: false,
			runId: 'run-1',
			step: 'implement',
			onProgress: () => undefined,
		});
		const onUnreadableStatus = await runSelfCheck({
			cwd: unreadable.dir,
			config: unreadable.config,
			coverage: false,
			checkpoint: 'verify-implement',
			wholeRepository: false,
			runId: 'run-1',
			step: 'implement',
			onProgress: () => undefined,
		});

		// nothing to check and could-not-work-out-what-to-check are different
		// answers: one is the tree being clean, the other is the engine failing
		expect([onUnchangedTree.reason, onUnreadableStatus.reason]).toStrictEqual(['nothing-changed', 'unavailable']);
		// neither widens: the whole repository's suite inside the agent's own
		// timeout is the cost a scoped self-check exists to avoid
		expect([unchanged.log(), unreadable.log()]).toStrictEqual([[], []]);
	});

	test('runSelfCheck: reports that it ran nothing when every scheduled gate was skipped, never the gate-override error', async () => {
		const { dir, config, log } = await setupSelfCheck({
			gates: { check: rootGate({ kind: 'check' }), test: rootGate({ kind: 'test' }), 'test-coverage': false },
			// every template names a script the package does not declare, so each one
			// is script-detected as absent and skipped
			packageGates: { check: `${packageGate({ kind: 'check' })} run gate:check`, test: `${packageGate({ kind: 'test' })} run gate:test` },
			scripts: {},
		});

		const result = await runSelfCheck({
			cwd: dir,
			config,
			coverage: false,
			checkpoint: 'verify-implement',
			wholeRepository: false,
			runId: 'run-1',
			step: 'implement',
			onProgress: () => undefined,
		});

		expect(result.reason).toBe('nothing-scheduled');
		// the engine's own answer here names `gate-overrides`, a block this consumer
		// may never have written and this caller never used — a round spent on the
		// engine rather than on the code
		expect(result.error).toBe(undefined);
		expect(result.gates.map((observation) => [observation.group, observation.kind, observation.skipped])).toStrictEqual([
			['api', 'check', true],
			['api', 'test', true],
		]);
		expect(log()).toStrictEqual([]);
	});

	test("runSelfCheck: runs the root gate set over the whole tree with coverage on, the way the direct pipeline's own pass does", async () => {
		const { dir, config, log } = await setupSelfCheck();

		const result = await runSelfCheck({
			cwd: dir,
			config,
			coverage: true,
			wholeRepository: true,
			runId: 'run-1',
			step: 'implement',
			onProgress: () => undefined,
		});

		// that pipeline names no checkpoint and reads no diff, so neither does its
		// self-check: the root block over the whole tree, coverage included, and the
		// scoped block left unused even though this repo configures one. The plain
		// unit suite is absent because the instrumented one is the same tests again.
		expect(result.reason).toBe('ran');
		expect(result.gateNames).toStrictEqual(['check', 'test-coverage', 'build']);
		expect(log()).toStrictEqual(['root check', 'root coverage', 'root build']);
	});

	test('runSelfCheck: runs the root gates for a change outside the packages dir, rather than the package groups', async () => {
		const { dir, config, log } = await setupSelfCheck({ changed: ['README.md'] });

		const result = await runSelfCheck({
			cwd: dir,
			config,
			coverage: false,
			checkpoint: 'verify-implement',
			wholeRepository: false,
			runId: 'run-1',
			step: 'implement',
			onProgress: () => undefined,
		});

		// a file belonging to no package is whole-repository precedence, exactly as
		// the checkpoint that follows resolves it
		expect(result.reason).toBe('ran');
		expect(log()).toStrictEqual(['root check', 'root test', 'root build']);
	});

	test('runSelfCheck: hands a red gate back as the error and the output the agent repairs from', async () => {
		const { dir, config, log } = await setupSelfCheck({
			// a single-package repo: no scoped block at all, so the names and the
			// commands both come from the root block
			packageGates: null,
			gates: {
				check: `${rootGate({ kind: 'check' })} && echo "src/added.js:1 unused import" && exit 1`,
				test: rootGate({ kind: 'test' }),
				'test-coverage': false,
				build: rootGate({ kind: 'build' }),
			},
		});

		const result = await runSelfCheck({
			cwd: dir,
			config,
			coverage: false,
			checkpoint: 'verify-implement',
			wholeRepository: false,
			runId: 'run-1',
			step: 'implement',
			onProgress: () => undefined,
		});

		expect(result.reason).toBe('ran');
		// the red is what the agent reads its own mistake off, so the failing gate
		// and the output it left both survive the trip back
		expect(result.error).toContain('check failed (exit 1)');
		expect(result.gates.map((observation) => observation.outputTail)).toEqual([expect.stringContaining('src/added.js:1 unused import')]);
		// and the exact schedule stopped there — gates behind a red one buy nothing
		expect(log()).toStrictEqual(['root check']);
	});
});
