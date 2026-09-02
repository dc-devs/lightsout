import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from '@jest/globals';
import { readConfig } from '#src/common/config/readConfig.ts';
import type { Driver } from '#src/drivers/index.ts';
import { runImplementPipeline } from '#src/pipeline/index.ts';
import { report } from '#tests/helpers/report.ts';
import { reviewReport } from '#tests/helpers/reviewReport.ts';
import { roleOf } from '#tests/helpers/roleOf.ts';
import { setupConsumerRepo } from '#tests/helpers/setupConsumerRepo.ts';
import { writeSource } from '#tests/helpers/writeSource.ts';

const readCommandLog = ({ dir, runId }: { dir: string; runId: string }): Record<string, unknown>[] =>
	readFileSync(join(dir, '.lightsout', 'runs', runId, 'commands.jsonl'), 'utf8')
		.trim()
		.split('\n')
		.map((line) => JSON.parse(line) as Record<string, unknown>);

const setupFormatRun = async ({ format }: { format: string }) => {
	const dir = setupConsumerRepo({ scripts: { format, test: 'true' } });
	const driver: Driver = {
		name: 'stub',
		invoke: async ({ prompt }) => {
			const role = roleOf(prompt);

			if (role === 'standards-review') {
				return { text: reviewReport(), exitCode: 0 };
			}

			if (role === 'write-tests') {
				mkdirSync(join(dir, 'test'), { recursive: true });
				writeFileSync(join(dir, 'test/feature.test.js'), '// stub test\n');

				return { text: report({ changedFiles: [{ path: 'test/feature.test.js', summary: 'tests' }] }), exitCode: 0 };
			}

			if (role === 'refactor') {
				return { text: report(), exitCode: 0 };
			}

			writeSource({ dir, path: 'src/feature.js', source: 'export const feature = () => 2;\n' });

			return { text: report({ changedFiles: [{ path: 'src/feature.js', summary: 'feature' }] }), exitCode: 0 };
		},
	};

	return { dir, driver, config: await readConfig({ cwd: dir }) };
};

test('formatting runs after every code-writing phase and before its verification gates', async () => {
	const { dir, driver, config } = await setupFormatRun({ format: 'true' });
	const result = await runImplementPipeline({ cwd: dir, driver, config, planPath: 'plan.md' });

	expect(result.ok).toBe(true);

	const records = readCommandLog({ dir, runId: result.manifest.runId });
	const indexOf = ({ step, kind }: { step: string; kind: string }) => records.findIndex((record) => record.step === step && record.kind === kind);

	expect(indexOf({ step: 'format-implement', kind: 'format' })).toBeLessThan(indexOf({ step: 'verify-implement', kind: 'check' }));
	expect(indexOf({ step: 'format-tests', kind: 'format' })).toBeLessThan(indexOf({ step: 'verify-tests', kind: 'check' }));
	expect(indexOf({ step: 'format-refactor', kind: 'format' })).toBeLessThan(indexOf({ step: 'verify-refactor', kind: 'check' }));
});

test('the skip-refactor path formats implementation and tests but declares no refactor formatter', async () => {
	const { dir, driver, config } = await setupFormatRun({ format: 'true' });
	const result = await runImplementPipeline({ cwd: dir, driver, config, planPath: 'plan.md', skipRefactor: true });
	const steps = readCommandLog({ dir, runId: result.manifest.runId }).map((record) => record.step);

	expect(steps.includes('format-implement')).toBe(true);
	expect(steps.includes('format-tests')).toBe(true);
	expect(steps.includes('format-refactor')).toBe(false);
});

test('a red dynamic formatter step fails the run before its following verification command', async () => {
	const { dir, driver, config } = await setupFormatRun({ format: 'echo FORMATTER-SENTINEL >&2; exit 3' });
	const result = await runImplementPipeline({ cwd: dir, driver, config, planPath: 'plan.md', skipRefactor: true });

	expect(result.ok).toBe(false);
	expect(result.error ?? '').toMatch(/format failed \(exit 3\)/);
	expect(result.error ?? '').toMatch(/FORMATTER-SENTINEL/);
	expect(result.manifest.steps.find((step) => step.id === 'format-implement')?.status).toBe('failed');

	const records = readCommandLog({ dir, runId: result.manifest.runId });
	const formatter = records.find((entry) => entry.step === 'format-implement' && entry.kind === 'format');

	expect(formatter?.exitCode).toBe(3);
	expect(String(formatter?.outputTail)).toMatch(/FORMATTER-SENTINEL/);
	expect(records.some((entry) => entry.step === 'verify-implement')).toBe(false);
});
