import { execSync } from 'node:child_process';
import { readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from '@jest/globals';
import { loadConfig } from '#src/common/utils/loadConfig.ts';
import type { Driver } from '#src/drivers/index.ts';
import { runRefactorPipeline } from '#src/refactor/index.ts';
import { report } from '#tests/helpers/report.ts';
import { reviewReport } from '#tests/helpers/reviewReport.ts';
import { roleOf } from '#tests/helpers/roleOf.ts';
import { setupConsumerRepo } from '#tests/helpers/setupConsumerRepo.ts';
import { writeSource } from '#tests/helpers/writeSource.ts';

// v1.2 — supervisor consult on the red-gate exception path. The fixture's
// check gate fails while broken.flag exists; the executor's "fix" plants the
// flag, cheap fixes shrug, and only the supervisor-guided invocation removes it.

const commitAll = (dir: string) => execSync('git add -A && git -c user.name=t -c user.email=t@t commit -qm fixture', { cwd: dir });

const supervisorFixture = () => {
	const dir = setupConsumerRepo({ scripts: { check: 'test ! -f broken.flag' } });

	writeSource({ dir, path: 'src/multi.ts', source: 'export const alpha = 1;\nexport const beta = 2;\n' });
	commitAll(dir);

	return dir;
};

/** A stub whose executor resolves the finding but breaks the gate; cheap fixes are no-ops. */
const gateBreakingInvoke = ({
	dir,
	prompts,
	onSupervisor,
}: {
	dir: string;
	prompts: string[];
	onSupervisor: () => { text: string; exitCode: number; rateLimited?: boolean };
}): Driver['invoke'] => {
	let executorCalls = 0;

	return async ({ prompt }) => {
		if (roleOf(prompt) === 'standards-review') {
			return { text: reviewReport(), exitCode: 0 };
		}

		prompts.push(prompt);

		if (prompt.includes('# Failing step')) {
			return onSupervisor();
		}

		if (prompt.includes('# Supervisor guidance')) {
			rmSync(join(dir, 'broken.flag'));

			return { text: report(), exitCode: 0 };
		}

		executorCalls += 1;

		if (executorCalls === 1) {
			writeSource({ dir, path: 'src/multi.ts', source: 'export const alpha = 1;\n' });
			writeSource({ dir, path: 'src/beta.ts', source: 'export const beta = 2;\n' });
			writeFileSync(join(dir, 'broken.flag'), 'red\n');

			return {
				text: report({
					changedFiles: [
						{ path: 'src/multi.ts', summary: 'split' },
						{ path: 'src/beta.ts', summary: 'split' },
					],
				}),
				exitCode: 0,
			};
		}

		return { text: report(), exitCode: 0 };
	};
};

test('refactor: supervisor guidance rescues a red-gated batch', async () => {
	const dir = supervisorFixture();
	const prompts: string[] = [];
	const driver: Driver = {
		name: 'stub',
		invoke: gateBreakingInvoke({
			dir,
			prompts,
			onSupervisor: () => ({
				text: JSON.stringify({ decision: 'retry', diagnosis: 'broken.flag trips the check gate', guidance: 'delete broken.flag' }),
				exitCode: 0,
				usage: { inputTokens: 10, outputTokens: 5, cacheReadTokens: 0, cacheCreationTokens: 0, costUsd: 0.01 },
			}),
		}),
	};

	const result = await runRefactorPipeline({ cwd: dir, driver, config: await loadConfig({ cwd: dir }) });

	// the guided retry must rescue the batch: ${result.error}
	expect(result.ok).toBe(true);
	// the finding burned down
	expect(result.after['multi-export'] ?? 0).toBe(0);

	const guided = prompts.find((prompt) => prompt.includes('# Supervisor guidance'));

	// the diagnosis rides the guided retry
	expect(guided?.includes('broken.flag trips the check gate')).toBeTruthy();
	// the guidance rides the guided retry
	expect(guided?.includes('delete broken.flag')).toBeTruthy();

	const ledger = readFileSync(join(dir, '.lightsout/runs', result.manifest.runId, 'agents.jsonl'), 'utf8');

	// the consult is on the usage ledger
	expect(ledger.includes(':supervisor')).toBeTruthy();
});

test('refactor: a supervisor escalate verdict ends the run with the diagnosis attached', async () => {
	const dir = supervisorFixture();
	const driver: Driver = {
		name: 'stub',
		invoke: gateBreakingInvoke({
			dir,
			prompts: [],
			onSupervisor: () => ({
				text: JSON.stringify({ decision: 'escalate', diagnosis: 'the gate red is a real defect a human must rule on' }),
				exitCode: 0,
			}),
		}),
	};

	const result = await runRefactorPipeline({ cwd: dir, driver, config: await loadConfig({ cwd: dir }) });

	expect(result.ok).toBe(false);
	expect(result.manifest.status).toBe('escalated');
	// the diagnosis is the escalation evidence
	expect(result.error ?? '').toMatch(/a human must rule on/);
});

test('refactor: a rate-limited supervisor parks the run, not fails it', async () => {
	const dir = supervisorFixture();
	const driver: Driver = {
		name: 'stub',
		invoke: gateBreakingInvoke({
			dir,
			prompts: [],
			onSupervisor: () => ({ text: 'usage limit reached', exitCode: 1, rateLimited: true }),
		}),
	};

	const result = await runRefactorPipeline({ cwd: dir, driver, config: await loadConfig({ cwd: dir }) });

	expect(result.ok).toBe(false);
	// rate-limit exhaustion is a pausable state, never an error
	expect(result.manifest.status).toBe('paused-rate-limit');
});
