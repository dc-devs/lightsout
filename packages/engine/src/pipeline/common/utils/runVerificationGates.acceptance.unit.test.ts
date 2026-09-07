import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from '@jest/globals';
import { readConfig } from '#src/common/config/readConfig.ts';
import { runVerificationGates } from '#src/pipeline/common/utils/runVerificationGates.ts';
import type { PipelineRun } from '#src/pipeline/PipelineRun.ts';
import { gateResultsCommand } from '#tests/helpers/gateResultsCommand.ts';
import { linkTypescript } from '#tests/helpers/linkTypescript.ts';
import { setupConsumerRepo } from '#tests/helpers/setupConsumerRepo.ts';

const runId = 'run-1';
const changed = 'src/feature.ts';
const acceptanceFile = 'src/widget.unit.test.ts';
const acceptanceName = 'widget: renders';

/**
 * An Istanbul json-summary at the default path saying the changed file never
 * executed — the report the per-file executed check reads. Written by hand so
 * that check has a known verdict to reach, which is how the fall-through case
 * below becomes observable.
 */
const writeUnexecutedSummary = ({ dir }: { dir: string }) => {
	mkdirSync(join(dir, 'coverage'), { recursive: true });
	writeFileSync(
		join(dir, 'coverage', 'coverage-summary.json'),
		JSON.stringify({
			total: { statements: { pct: 0, covered: 0, total: 4 } },
			[join(dir, changed)]: { statements: { pct: 0, covered: 0, total: 4 } },
		}),
	);
};

/**
 * A consumer repo whose test and coverage gates leave per-test evidence behind,
 * whose one changed file is reported as never executed, and whose `verify-tests`
 * checkpoint runs exactly the gates the case is about. TypeScript is linked
 * because without a consumer compiler the executed check stands down entirely.
 */
const setupAcceptanceRun = async ({ schedule, tests }: { schedule: string[]; tests: { file: string; name: string; status?: string }[] }) => {
	const dir = setupConsumerRepo({
		scripts: { check: 'true', test: gateResultsCommand({ tests }), 'test-coverage': gateResultsCommand({ tests }) },
		config: { 'gate-overrides': { 'verify-tests': schedule } },
		sources: { [changed]: 'export const feature = (): number => 1;\n' },
	});

	linkTypescript({ dir });
	writeUnexecutedSummary({ dir });

	const run = {
		cwd: dir,
		config: await readConfig({ cwd: dir }),
		current: () => ({ runId, changedFiles: [changed], packages: [], currentStep: 'verify-tests', unreachableChangedFiles: [] }),
		progress: () => {},
	};

	return { dir, run: run as unknown as PipelineRun };
};

test('runVerificationGates: fails the checkpoint under acceptance-tests when a row did not execute and pass', async () => {
	const { run } = await setupAcceptanceRun({ schedule: ['test'], tests: [{ file: acceptanceFile, name: 'widget: something else' }] });

	const result = await runVerificationGates({
		run,
		coverage: false,
		checkpoint: 'verify-tests',
		rows: [{ testFile: acceptanceFile, testName: acceptanceName, gate: 'test' }],
	});

	// the gate itself ran green — the checkpoint is red only because the row it
	// had to prove never executed, so the acceptance family stands alone and no
	// gate family is dragged red with it
	expect(result.failedFamilies).toStrictEqual(['acceptance-tests']);
	expect(result.failures).toStrictEqual([]);
	expect(result.error ?? '').toContain(acceptanceName);
	expect(result.error ?? '').toContain(acceptanceFile);
	expect((result.gates ?? []).filter((gate) => gate.kind === 'test').map((gate) => gate.exitCode)).toStrictEqual([0]);
});

test('runVerificationGates: runs the changed-file execution check only once every acceptance row is proven', async () => {
	const { run } = await setupAcceptanceRun({ schedule: ['test-coverage'], tests: [{ file: acceptanceFile, name: acceptanceName, status: 'passed' }] });

	const result = await runVerificationGates({
		run,
		coverage: false,
		checkpoint: 'verify-tests',
		rows: [{ testFile: acceptanceFile, testName: acceptanceName, gate: 'test-coverage' }],
	});

	// the row executed and passed, so the acceptance check stands aside and the
	// checkpoint reaches the per-file executed check exactly as it does today —
	// the never-executed changed file is what proves it got there
	expect(result.failedFamilies).toStrictEqual(['changed-files-executed']);
	expect(result.error ?? '').toContain('changed-file-execution: 1 changed file(s) never executed under the tests: src/feature.ts');
});
