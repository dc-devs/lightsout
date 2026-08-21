import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, test } from '@jest/globals';
import type { AgentUsage, LightsoutConfig } from '#src/contracts/index.ts';
import { invokeCoverageAgent } from '#src/coverage/batch/invokeCoverageAgent.ts';
import type { Driver, DriverInvocation } from '#src/drivers/index.ts';
import { report } from '#tests/helpers/report.ts';

const runId = 'run-1';
// The colon is what the evidence file names have to survive: a run directory is
// a real path, and a batch id is not.
const batchId = 'batch-01:root';
const stubUsage: AgentUsage = { inputTokens: 10, outputTokens: 100, cacheReadTokens: 1_000, cacheCreationTokens: 5, costUsd: 0.5 };

const baseConfig: LightsoutConfig = { gates: { check: 'true', test: 'true', 'test-coverage': 'true' } };
const fullAccessConfig: LightsoutConfig = { ...baseConfig, permissions: 'full-access' };

/**
 * The event sink appends on a promise tail rather than on the awaited path, so
 * the transcript is still landing when the invocation returns. Polls for the
 * expected number of lines rather than for the file, or a read between two
 * appends would see a half-written stream.
 */
const readStreamLines = async ({ path, expected }: { path: string; expected: number }) => {
	const lines = () => (existsSync(path) ? readFileSync(path, 'utf8') : '');

	for (let attempt = 1; attempt <= 100 && lines().split('\n').length <= expected; attempt += 1) {
		await new Promise((resolve) => setTimeout(resolve, 20));
	}

	return lines();
};

/**
 * One coverage invocation over a temp repo, with the batch-level collectors and
 * usage ledger the real caller owns held here so a test can read what the
 * invocation folded into them.
 */
const setupInvocation = ({
	config = baseConfig,
	text = report(),
	events = [],
}: {
	config?: LightsoutConfig;
	/** The stub harness's final message — anything the WorkReport contract rejects drives the failure path. */
	text?: string;
	/** Harness stream events the driver replays into the engine's sink. */
	events?: unknown[];
} = {}) => {
	const cwd = mkdtempSync(join(tmpdir(), 'lightsout-coverage-agent-'));
	const invocations: DriverInvocation[] = [];
	const driver: Driver = {
		name: 'stub',
		invoke: async (invocation) => {
			invocations.push(invocation);

			for (const event of events) {
				invocation.onEvent?.(event);
			}

			return { text, exitCode: 0, usage: stubUsage };
		},
	};
	const reportedFiles = new Set<string>();
	const rationale: string[] = [];
	const ledger: { step: string; usage?: AgentUsage }[] = [];

	const invoke = ({ label = '', invocationCount = 1 }: { label?: string; invocationCount?: number } = {}) =>
		invokeCoverageAgent({
			cwd,
			runId,
			driver,
			config,
			batchId,
			invocation: { systemPrompt: 'the writer role', prompt: 'cover src/target.ts' },
			label,
			invocationCount,
			agentTimeoutMs: 60_000,
			reportedFiles,
			rationale,
			recordUsage: async (entry) => {
				ledger.push(entry);
			},
		});

	const agentsDir = join(cwd, '.lightsout', 'runs', runId, 'agents');

	return { cwd, agentsDir, invoke, invocations, reportedFiles, rationale, ledger };
};

const frictionLines = ({ cwd }: { cwd: string }) => {
	const path = join(cwd, '.lightsout', 'friction.jsonl');

	return existsSync(path)
		? readFileSync(path, 'utf8')
				.trim()
				.split('\n')
				.map((line) => JSON.parse(line) as Record<string, unknown>)
		: [];
};

describe('invokeCoverageAgent', () => {
	test.each([
		{ named: 'defaults to write when the config sets no level', config: baseConfig, expected: 'write' },
		{ named: 'passes a configured full-access level through', config: fullAccessConfig, expected: 'full-access' },
	])('$named', async ({ config, expected }) => {
		const { invoke, invocations } = setupInvocation({ config });

		await invoke();

		expect(invocations[0]?.permissions).toBe(expected);
	});

	test('the harness is handed the run’s model, effort, granted commands and timeout', async () => {
		const { invoke, invocations } = setupInvocation({
			config: { ...baseConfig, model: 'stub-model', effort: 'xhigh', 'agent-commands': ['pnpm test'] },
		});

		await invoke();

		expect(invocations[0]).toEqual(expect.objectContaining({ model: 'stub-model', effort: 'xhigh', allowedCommands: ['pnpm test'], timeoutMs: 60_000 }));
	});

	test.each([
		{ named: 'the first invocation is recorded under the batch id alone', label: '', step: 'batch-01:root' },
		{ named: 'a labelled re-invocation is recorded under the batch id plus its label', label: 'fix-1', step: 'batch-01:root fix-1' },
	])('$named', async ({ label, step }) => {
		const { invoke, ledger } = setupInvocation();

		await invoke({ label });

		// the ledger is what a run's cost is read back from, per invocation
		expect(ledger).toStrictEqual([{ step, usage: stubUsage }]);
	});

	test('the report’s changed files are folded into the batch’s collector', async () => {
		const { invoke, reportedFiles } = setupInvocation({
			text: report({
				changedFiles: [
					{ path: 'src/target.unit.test.ts', summary: 'covers target' },
					{ path: 'src/other.unit.test.ts', summary: 'covers other' },
				],
			}),
		});

		const outcome = await invoke();

		expect(outcome.ok).toBe(true);
		// git truth is merged against this set, so a file the agent named must land in it
		expect([...reportedFiles]).toStrictEqual(['src/target.unit.test.ts', 'src/other.unit.test.ts']);
	});

	test('reported friction is persisted to the repo’s friction log with its provenance', async () => {
		const { invoke, cwd } = setupInvocation({
			text: report({ friction: [{ kind: 'decision', area: 'plan', detail: 'no plan names this module' }] }),
		});

		await invoke();

		expect(frictionLines({ cwd })).toEqual([
			expect.objectContaining({ kind: 'decision', area: 'plan', detail: 'no plan names this module', runId: 'run-1', step: 'batch-01:root' }),
		]);
	});

	test('reported friction also becomes a rationale line the batch report carries', async () => {
		const { invoke, rationale } = setupInvocation({
			text: report({
				friction: [
					{ kind: 'friction', area: 'standards', detail: 'the cap and the mirror disagree' },
					{ kind: 'decision', area: 'environment', detail: 'no coverage config in this package' },
				],
			}),
		});

		await invoke();

		expect(rationale).toStrictEqual(['[standards] the cap and the mirror disagree', '[environment] no coverage config in this package']);
	});

	test('a clean report leaves the friction log unwritten and the rationale empty', async () => {
		const { invoke, cwd, rationale } = setupInvocation({ text: report({ friction: [] }) });

		await invoke();

		// an empty list is not a friction record — the log stays a signal, not a diary
		expect(existsSync(join(cwd, '.lightsout', 'friction.jsonl'))).toBe(false);
		expect(rationale).toStrictEqual([]);
	});

	test('an output the contract rejects is persisted as run evidence, once per attempt', async () => {
		const { invoke, agentsDir } = setupInvocation({ text: 'I wrote the tests, trust me.' });

		const outcome = await invoke();

		expect(outcome.ok).toBe(false);
		// the colon in the batch id is flattened, so the evidence has a writable name
		expect(readFileSync(join(agentsDir, 'rejected-batch-01_root-1-1.txt'), 'utf8')).toBe('I wrote the tests, trust me.');
		expect(readFileSync(join(agentsDir, 'rejected-batch-01_root-1-2.txt'), 'utf8')).toBe('I wrote the tests, trust me.');
	});

	test('a rejected invocation still costs tokens, and still leaves the collectors untouched', async () => {
		const { invoke, ledger, reportedFiles, rationale } = setupInvocation({ text: 'no report' });

		const outcome = await invoke();

		expect(outcome.ok === false && outcome.failure).toMatch(/did not match contract/);
		// both attempts burned tokens, so the ledger charges the batch for both
		expect(ledger).toStrictEqual([
			{ step: 'batch-01:root', usage: { inputTokens: 20, outputTokens: 200, cacheReadTokens: 2_000, cacheCreationTokens: 10, costUsd: 1 } },
		]);
		expect([...reportedFiles]).toStrictEqual([]);
		expect(rationale).toStrictEqual([]);
	});

	test('the harness event stream is teed to the run directory, one JSON line per event', async () => {
		const { invoke, agentsDir } = setupInvocation({ events: [{ type: 'tool_use', name: 'Write' }, { type: 'result' }] });

		await invoke({ invocationCount: 2 });

		// the transcript is a run's evidence, and it is named by the invocation it belongs to
		const stream = await readStreamLines({ path: join(agentsDir, 'stream-batch-01_root-2.jsonl'), expected: 2 });

		expect(stream).toBe('{"type":"tool_use","name":"Write"}\n{"type":"result"}\n');
	});
});
