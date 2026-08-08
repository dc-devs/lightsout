import { execSync } from 'node:child_process';
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, describe, test } from '@jest/globals';
import type { Driver } from '@/drivers';
import { loadConfig } from '@/common/utils/loadConfig';
import { runRefactorPipeline } from '@/refactor';
import { report } from '@tests/helpers/report';
import { setupConsumerRepo } from '@tests/helpers/setupConsumerRepo';

/** Two exported consts in one file — a compiler-free structure Finding (multi-export). */
const multiExport = 'export const alphaThing = 1;\nexport const betaThing = 2;\n';

/** The single batch a one-finding repo produces: `batch-NN:<rule>:<folder>`. */
const batchId = 'batch-01:structure:src';

/** A final message carrying no report at all — the shape the contract rejects. */
const prose = 'Split the file — see the diff. (no JSON from me)';

/** Split the fixture's multi-export file: the edit that resolves the finding. */
const splitMulti = ({ dir }: { dir: string }) => {
	writeFileSync(join(dir, 'src/multi.ts'), 'export const alphaThing = 1;\n');
	writeFileSync(join(dir, 'src/betaThing.ts'), 'export const betaThing = 2;\n');
};

/**
 * A repo whose single multi-export finding gives the run exactly one batch,
 * wired to a caller-supplied stub whose invocations produce the evidence
 * under test.
 */
const setupBatchRun = async ({ config, invoke }: { config?: Record<string, unknown>; invoke: (repo: string) => Driver['invoke'] }) => {
	const dir = setupConsumerRepo({ config });

	writeFileSync(join(dir, 'src/multi.ts'), multiExport);
	execSync('git add -A && git -c user.name=t -c user.email=t@t commit -qm fixture', { cwd: dir });

	const driver: Driver = { name: 'stub', invoke: invoke(dir) };

	return { dir, driver, config: await loadConfig({ cwd: dir }) };
};

/** The run's agent-evidence directory. */
const agentsDirOf = ({ dir, runId }: { dir: string; runId: string }) => join(dir, '.lightsout', 'runs', runId, 'agents');

describe('runRefactorPipeline batch evidence', () => {
	test('tees a batch invocation’s event stream to the run dir, named for the batch and invocation', async () => {
		const { dir, driver, config } = await setupBatchRun({
			invoke: (repo) => async ({ onEvent }) => {
				onEvent?.({ type: 'assistant', message: 'editing' });
				onEvent?.({ type: 'result', result: 'done' });
				splitMulti({ dir: repo });

				return { text: report({ changedFiles: [{ path: 'src/multi.ts', summary: 'split' }, { path: 'src/betaThing.ts', summary: 'split' }] }), exitCode: 0 };
			},
		});

		const result = await runRefactorPipeline({ cwd: dir, driver, config });

		expect(result.ok).toBe(true);

		const agentsDir = agentsDirOf({ dir, runId: result.manifest.runId });
		const streams = readdirSync(agentsDir).filter((name) => name.startsWith('stream-'));

		// the batch id is slugged into the name, with the invocation number
		expect(streams).toStrictEqual(['stream-batch-01_structure_src-1.jsonl']);
		// every event lands verbatim, in order — the transcript is the run’s evidence
		expect(readFileSync(join(agentsDir, streams[0] ?? ''), 'utf8')
			.trim()
			.split('\n')
			.map((line) => JSON.parse(line) as Record<string, unknown>)).toStrictEqual([
			{ type: 'assistant', message: 'editing' },
			{ type: 'result', result: 'done' },
		]);
	});

	test('files a rejected batch report to the run dir before the re-emit retry', async () => {
		const { dir, driver, config } = await setupBatchRun({
			invoke: (repo) => async ({ prompt }) => {
				if (prompt.includes('# Your previous final message')) {
					return { text: report({ changedFiles: [{ path: 'src/multi.ts', summary: 'split' }, { path: 'src/betaThing.ts', summary: 'split' }] }), exitCode: 0 };
				}

				splitMulti({ dir: repo });

				return { text: prose, exitCode: 1 };
			},
		});

		const result = await runRefactorPipeline({ cwd: dir, driver, config });

		expect(result.ok).toBe(true);

		const agentsDir = agentsDirOf({ dir, runId: result.manifest.runId });
		const rejected = readdirSync(agentsDir).filter((name) => name.startsWith('rejected-'));

		// the rejected message is filed by batch, invocation, and attempt
		expect(rejected).toStrictEqual(['rejected-batch-01_structure_src-1-1.txt']);
		// the raw final message is preserved verbatim, not summarized
		expect(readFileSync(join(agentsDir, rejected[0] ?? ''), 'utf8')).toBe(prose);
	});

	test('appends a batch agent’s friction to the repo ledger with the batch as its provenance', async () => {
		const { dir, driver, config } = await setupBatchRun({
			invoke: () => async () => ({
				text: report({ friction: [{ area: 'standards', kind: 'friction', detail: 'the size cap and the barrel rule disagreed' }] }),
				exitCode: 0,
			}),
		});

		const result = await runRefactorPipeline({ cwd: dir, driver, config });

		expect(result.ok).toBe(true);
		// the improvement loop needs to know which batch of which run fought the agent
		expect(readFileSync(join(dir, '.lightsout', 'friction.jsonl'), 'utf8')
			.trim()
			.split('\n')
			.map((line) => JSON.parse(line) as Record<string, unknown>)
			.map(({ kind, area, detail, step, runId }) => ({ kind, area, detail, step, runId }))).toStrictEqual([
			{
				kind: 'friction',
				area: 'standards',
				detail: 'the size cap and the barrel rule disagreed',
				step: batchId,
				runId: result.manifest.runId,
			},
		]);
		// and the same friction is the decline’s rationale for the human
		expect(result.declined.map((entry) => entry.rationale)).toStrictEqual([['[standards] the size cap and the barrel rule disagreed']]);
	});

	test('attributes a file the agent changed but never reported — git truth is merged in', async () => {
		const { dir, driver, config } = await setupBatchRun({
			invoke: (repo) => async () => {
				splitMulti({ dir: repo });

				return { text: report({ changedFiles: [{ path: 'src/multi.ts', summary: 'split' }] }), exitCode: 0 };
			},
		});

		const result = await runRefactorPipeline({ cwd: dir, driver, config });

		expect(result.ok).toBe(true);
		// the forgotten file is still the batch’s doing — agents can forget, git
		// cannot be sweet-talked
		expect([...result.manifest.changedFiles].sort()).toStrictEqual(['src/betaThing.ts', 'src/multi.ts']);
	});

	test('keeps generated output out of a batch’s changed files', async () => {
		const { dir, driver, config } = await setupBatchRun({
			config: { generated: ['dist/'] },
			invoke: (repo) => async () => {
				splitMulti({ dir: repo });
				mkdirSync(join(repo, 'dist'), { recursive: true });
				writeFileSync(join(repo, 'dist/bundle.js'), 'export const bundled = 1;\n');

				return { text: report({ changedFiles: [{ path: 'src/multi.ts', summary: 'split' }] }), exitCode: 0 };
			},
		});

		const result = await runRefactorPipeline({ cwd: dir, driver, config });

		expect(result.ok).toBe(true);
		// build output the run happened to produce is not work the human must review
		expect([...result.manifest.changedFiles].sort()).toStrictEqual(['src/betaThing.ts', 'src/multi.ts']);
	});
});
