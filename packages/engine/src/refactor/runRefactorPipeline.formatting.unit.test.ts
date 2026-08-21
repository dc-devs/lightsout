import { execSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from '@jest/globals';
import { readConfig } from '#src/common/config/readConfig.ts';
import type { Driver } from '#src/drivers/index.ts';
import { runRefactorPipeline } from '#src/refactor/index.ts';
import { report } from '#tests/helpers/report.ts';
import { reviewReport } from '#tests/helpers/reviewReport.ts';
import { roleOf } from '#tests/helpers/roleOf.ts';
import { setupConsumerRepo } from '#tests/helpers/setupConsumerRepo.ts';
import { writeSource } from '#tests/helpers/writeSource.ts';

/** Two exported consts in one file — a compiler-free structure finding (multi-export). */
const multiExport = 'export const alphaThing = 1;\nexport const betaThing = 2;\n';

/**
 * A formatter that copies the file the agent creates into a witness, so the
 * witness exists only if the formatter ran AFTER the write it is supposed to
 * tidy. A formatter run too early cannot find the source and exits red.
 */
const witnessingFormatter = "node -e \"require('fs').copyFileSync('src/betaThing.ts', 'formatter-saw.txt')\"";

/** The file the agent writes, in the state an agent leaves it — house style is the engine's job, not its. */
const agentOutput = 'export const betaThing   =   2;\n';

/**
 * A repo whose single multi-export finding gives the run one batch, with a
 * stub that resolves the finding by splitting the file.
 */
const setupRun = async ({ scripts }: { scripts?: Record<string, string> } = {}) => {
	const dir = setupConsumerRepo({ scripts });

	writeSource({ dir, path: 'src/multi.ts', source: multiExport });
	execSync('git add -A && git -c user.name=t -c user.email=t@t commit -qm fixture', { cwd: dir });

	const driver: Driver = {
		name: 'stub',
		invoke: async ({ prompt }) => {
			if (roleOf(prompt) === 'standards-review') {
				return { text: reviewReport(), exitCode: 0 };
			}

			writeSource({ dir, path: 'src/multi.ts', source: 'export const alphaThing = 1;\n' });
			writeSource({ dir, path: 'src/betaThing.ts', source: agentOutput });

			return {
				text: report({
					changedFiles: [
						{ path: 'src/multi.ts', summary: 'split' },
						{ path: 'src/betaThing.ts', summary: 'split' },
					],
				}),
				exitCode: 0,
			};
		},
	};

	return { dir, driver, config: await readConfig({ cwd: dir }) };
};

describe('runRefactorPipeline formatting', () => {
	test('runs the repo’s formatter over what a batch’s agent wrote', async () => {
		const { dir, driver, config } = await setupRun({ scripts: { format: witnessingFormatter } });

		await runRefactorPipeline({ cwd: dir, driver, config });

		// The witness exists, so the formatter ran; its contents are the agent's
		// output, so it ran after the write rather than before it.
		expect(existsSync(join(dir, 'formatter-saw.txt'))).toBeTruthy();
		expect(readFileSync(join(dir, 'formatter-saw.txt'), 'utf8')).toBe(agentOutput);
	});

	test('completes a batch when the repo configures no formatter', async () => {
		const { dir, driver, config } = await setupRun();

		const result = await runRefactorPipeline({ cwd: dir, driver, config });

		// Nothing to run is not a failure — most repos of the engine's own making
		// have a formatter, and a repo without one must still refactor.
		expect(result.ok).toBeTruthy();
		expect(existsSync(join(dir, 'formatter-saw.txt'))).toBeFalsy();
	});

	test('a red formatter is announced, and does not fail the batch', async () => {
		const messages: string[] = [];
		const { dir, driver, config } = await setupRun({ scripts: { format: 'node -e "process.exit(3)"' } });

		const result = await runRefactorPipeline({ cwd: dir, driver, config, onProgress: (message) => messages.push(message) });

		// A formatter that cannot run is a human's configuration problem, not work
		// an agent can fix — so it is said out loud and the gates still decide.
		expect(messages.some((message) => message.includes('format failed (exit 3)'))).toBeTruthy();
		expect(result.ok).toBeTruthy();
	});
});
