import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from '@jest/globals';
import { report } from '@tests/helpers/report';
import { reviewReport } from '@tests/helpers/reviewReport';
import { roleOf } from '@tests/helpers/roleOf';
import { setupConsumerRepo } from '@tests/helpers/setupConsumerRepo';
import { loadConfig } from '@/common/utils/loadConfig';
import type { Driver } from '@/drivers';
import { runImplementPipeline } from '@/pipeline';

/** The run's command log as parsed records — the format step's evidence trail. */
const readCommandLog = ({ dir, runId }: { dir: string; runId: string }): Record<string, unknown>[] =>
	readFileSync(join(dir, '.lightsout', 'runs', runId, 'commands.jsonl'), 'utf8')
		.trim()
		.split('\n')
		.map((line) => JSON.parse(line) as Record<string, unknown>);

/**
 * A consumer repo whose run reaches the format step: implement lands one
 * source file, each writer drops one stub test, and the refactor pair is
 * skipped so the formatter is the only thing left to decide the run.
 */
const setupFormatRun = async ({ format, test: testCommand = 'true' }: { format: string; test?: string }) => {
	const dir = setupConsumerRepo({ scripts: { format, test: testCommand } });
	const driver: Driver = {
		name: 'stub',
		invoke: async ({ prompt }) => {
			if (roleOf(prompt) === 'standards-review') {
				return { text: reviewReport(), exitCode: 0 };
			}

			if (roleOf(prompt) === 'write-tests') {
				mkdirSync(join(dir, 'test'), { recursive: true });
				writeFileSync(join(dir, 'test/feature.test.js'), '// stub test\n');

				return { text: report({ changedFiles: [{ path: 'test/feature.test.js', summary: 'tests' }] }), exitCode: 0 };
			}

			writeFileSync(join(dir, 'src/feature.js'), 'export const feature = () => 2;\n');

			return { text: report({ changedFiles: [{ path: 'src/feature.js', summary: 'feature' }] }), exitCode: 0 };
		},
	};

	return { dir, driver, config: await loadConfig({ cwd: dir }) };
};

test('format: a formatter that exits non-zero fails the run and files its output as evidence', async () => {
	const { dir, driver, config } = await setupFormatRun({ format: 'echo FORMATTER-SENTINEL >&2; exit 3' });

	const result = await runImplementPipeline({ cwd: dir, driver, config, planPath: 'plan.md', skipRefactor: true });

	expect(result.ok).toBe(false);
	expect(result.manifest.status).toBe('failed');
	expect(result.error ?? '').toMatch(/format failed \(exit 3\)/);
	// the formatter output travels with the verdict
	expect(result.error ?? '').toMatch(/FORMATTER-SENTINEL/);
	expect(result.manifest.steps.find((step) => step.id === 'format')?.status).toBe('failed');

	const logged = readCommandLog({ dir, runId: result.manifest.runId }).find((entry) => entry.kind === 'format');

	// the failing formatter is logged with its exit code
	expect(logged?.exitCode).toBe(3);
	// and with the output tail a human needs
	expect(String(logged?.outputTail)).toMatch(/FORMATTER-SENTINEL/);
});

test('format: a green formatter that turns a gate red fails the run as a configuration problem', async () => {
	const { dir, driver, config } = await setupFormatRun({
		format: `node -e "require('fs').writeFileSync('BROKEN','x')"`,
		test: 'test ! -f BROKEN',
	});

	const result = await runImplementPipeline({ cwd: dir, driver, config, planPath: 'plan.md', skipRefactor: true });

	expect(result.ok).toBe(false);
	expect(result.manifest.status).toBe('failed');
	expect(result.error ?? '').toMatch(/format: formatting broke verification — review the formatter\/gate configuration\./);
	// the red gate that caught it is named
	expect(result.error ?? '').toMatch(/test failed/);
	expect(result.manifest.steps.find((step) => step.id === 'format')?.status).toBe('failed');

	const logged = readCommandLog({ dir, runId: result.manifest.runId }).find((entry) => entry.kind === 'format');

	// the formatter itself was green — only the gate after it was not
	expect(logged?.exitCode).toBe(0);
	// a green command carries no output tail
	expect(logged?.outputTail).toBe(undefined);
});
