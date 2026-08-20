import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from '@jest/globals';
import { loadConfig } from '#src/common/utils/loadConfig.ts';
import type { Driver } from '#src/drivers/index.ts';
import { runImplementPipeline } from '#src/pipeline/index.ts';
import { report } from '#tests/helpers/report.ts';
import { reviewReport } from '#tests/helpers/reviewReport.ts';
import { roleOf } from '#tests/helpers/roleOf.ts';
import { setupConsumerRepo } from '#tests/helpers/setupConsumerRepo.ts';

// A final message that carries no report at all — the shape the contract
// rejects and the re-emit invocation is handed back.
const implementProse = 'All done! I added the feature; see the diff for the details.';
const writerProse = 'I covered the changed file with a unit test — no JSON from me.';

const isReemit = (prompt: string) => prompt.includes('# Your previous final message');

test('a final message that fails the report contract is saved to the run dir before the re-emit retry', async () => {
	const dir = setupConsumerRepo();

	const driver: Driver = {
		name: 'stub',
		invoke: async ({ prompt }) => {
			if (isReemit(prompt)) {
				return { text: report({ changedFiles: [{ path: 'src/feature.js', summary: 'feature' }] }), exitCode: 0 };
			}

			const role = roleOf(prompt);

			if (role === 'standards-review') {
				return { text: reviewReport(), exitCode: 0 };
			}

			if (role === 'write-tests') {
				writeFileSync(join(dir, 'test.feature.test.js'), '// stub\n');

				return { text: report({ changedFiles: [{ path: 'test.feature.test.js', summary: 'tests' }] }), exitCode: 0 };
			}

			if (role === 'refactor') {
				return { text: report(), exitCode: 0 };
			}

			writeFileSync(join(dir, 'src/feature.js'), 'export const feature = () => 2;\n');

			return { text: implementProse, exitCode: 0 };
		},
	};

	const progressLines: string[] = [];
	const result = await runImplementPipeline({
		cwd: dir,
		driver,
		config: await loadConfig({ cwd: dir }),
		planPath: 'plan.md',
		onProgress: (message) => progressLines.push(message),
	});

	expect(result.ok).toBe(true);

	const agentsDir = join(dir, '.lightsout', 'runs', result.manifest.runId, 'agents');
	const rejected = readdirSync(agentsDir).filter((name) => name.startsWith('rejected-'));

	// the rejected message is filed by sequence, step, and attempt
	expect(rejected).toStrictEqual(['rejected-01-implement-attempt1.txt']);

	const saved = readFileSync(join(agentsDir, rejected[0] ?? ''), 'utf8');

	// the header names the step and attempt the text came from
	expect(saved).toMatch(/^# step: implement · invocation attempt 1\n# validation: /);
	// the raw final message is preserved verbatim, not summarized
	expect(saved.includes(implementProse)).toBeTruthy();
	// the run is told where the evidence landed:\n${progressLines.join('\n')}
	expect(progressLines.some((line) => line.includes(`.lightsout/runs/${result.manifest.runId}/agents/rejected-01-implement-attempt1.txt`))).toBeTruthy();
});

test('two rejected messages in one run are filed under distinct sequence numbers', async () => {
	const dir = setupConsumerRepo();

	const driver: Driver = {
		name: 'stub',
		invoke: async ({ prompt }) => {
			if (isReemit(prompt)) {
				return prompt.includes(writerProse)
					? { text: report({ changedFiles: [{ path: 'test.feature.test.js', summary: 'tests' }] }), exitCode: 0 }
					: { text: report({ changedFiles: [{ path: 'src/feature.js', summary: 'feature' }] }), exitCode: 0 };
			}

			const role = roleOf(prompt);

			if (role === 'standards-review') {
				return { text: reviewReport(), exitCode: 0 };
			}

			if (role === 'write-tests') {
				writeFileSync(join(dir, 'test.feature.test.js'), '// stub\n');

				return { text: writerProse, exitCode: 0 };
			}

			if (role === 'refactor') {
				return { text: report(), exitCode: 0 };
			}

			writeFileSync(join(dir, 'src/feature.js'), 'export const feature = () => 2;\n');

			return { text: implementProse, exitCode: 0 };
		},
	};

	const result = await runImplementPipeline({ cwd: dir, driver, config: await loadConfig({ cwd: dir }), planPath: 'plan.md' });

	expect(result.ok).toBe(true);

	const agentsDir = join(dir, '.lightsout', 'runs', result.manifest.runId, 'agents');
	const rejected = readdirSync(agentsDir)
		.filter((name) => name.startsWith('rejected-'))
		.sort();

	// a second rejection never overwrites the first — the counter runs across
	// steps
	expect(rejected).toStrictEqual(['rejected-01-implement-attempt1.txt', 'rejected-02-write-tests-attempt1.txt']);
	// each file holds its own step’s text
	expect(readFileSync(join(agentsDir, 'rejected-02-write-tests-attempt1.txt'), 'utf8').includes(writerProse)).toBeTruthy();
});
