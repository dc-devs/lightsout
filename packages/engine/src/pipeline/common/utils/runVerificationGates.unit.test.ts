import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { expect, test } from '@jest/globals';
import { readConfig } from '#src/common/config/readConfig.ts';
import { sha256 } from '#src/common/utils/sha256.ts';
import type { LedgerTestRecord } from '#src/contracts/index.ts';
import { ledgerCopyPath } from '#src/pipeline/common/utils/ledgerCopyPath.ts';
import { runVerificationGates } from '#src/pipeline/common/utils/runVerificationGates.ts';
import type { PipelineRun } from '#src/pipeline/PipelineRun.ts';
import { gateLogCommand } from '#tests/helpers/gateLogCommand.ts';
import { linkTypescript } from '#tests/helpers/linkTypescript.ts';
import { readGateLog } from '#tests/helpers/readGateLog.ts';
import { setupConsumerRepo } from '#tests/helpers/setupConsumerRepo.ts';

const runId = 'run-1';
const changed = 'src/feature.ts';
const ledgerPath = 'src/widget.unit.test.ts';
const locked = "test('widget: renders', () => {});\n";

/**
 * An Istanbul json-summary at the default path saying the changed file never
 * executed — absolute keys, exactly what a consumer's coverage command leaves
 * behind. Written by hand so the per-file executed check reads a known number.
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
 * A consumer repo whose three gates only log their name, whose one changed
 * file is reported as never executed, and whose `verify-tests` checkpoint
 * carries the override the case is about. TypeScript is linked because without
 * a consumer compiler the executed check stands down entirely.
 */
const setupCoverageRun = async ({ override }: { override: 'off' | string[] }) => {
	const dir = setupConsumerRepo({
		scripts: {
			check: `${gateLogCommand({ kind: 'check' })} root`,
			test: `${gateLogCommand({ kind: 'test' })} root`,
			'test-coverage': `${gateLogCommand({ kind: 'coverage' })} root`,
		},
		config: { 'gate-overrides': { 'verify-tests': override } },
		sources: { [changed]: 'export const feature = (): number => 1;\n' },
	});

	linkTypescript({ dir });
	writeUnexecutedSummary({ dir });

	const run = {
		cwd: dir,
		config: await readConfig({ cwd: dir }),
		current: () => ({ runId, changedFiles: [changed], packages: [], ledgerTests: [], currentStep: 'verify-tests', unreachableChangedFiles: [] }),
		progress: () => {},
	};

	return { dir, run: run as unknown as PipelineRun };
};

/** A repo holding one edited ledger test file, at a checkpoint whose override is "off". */
const setupLedgerRun = async () => {
	const dir = setupConsumerRepo({
		scripts: { check: `${gateLogCommand({ kind: 'check' })} root`, test: `${gateLogCommand({ kind: 'test' })} root` },
		config: { 'gate-overrides': { 'verify-tests': 'off' } },
	});
	const live = join(dir, ledgerPath);
	const copy = ledgerCopyPath({ cwd: dir, runId, path: ledgerPath });
	const record: LedgerTestRecord = { path: ledgerPath, testNames: ['widget: renders'], sha256: sha256({ content: locked }) };

	mkdirSync(dirname(copy), { recursive: true });
	writeFileSync(copy, locked);
	mkdirSync(dirname(live), { recursive: true });
	writeFileSync(live, "test('widget: renders', () => { expect(true).toBe(true); });\n");

	const progress: string[] = [];
	const run = {
		cwd: dir,
		config: await readConfig({ cwd: dir }),
		current: () => ({ runId, changedFiles: [], packages: [], ledgerTests: [record], currentStep: 'verify-tests', unreachableChangedFiles: [] }),
		progress: (message: string) => progress.push(message),
	};

	return { dir, live, progress, run: run as unknown as PipelineRun };
};

test('runVerificationGates: the changed-files-executed check follows a coverage gate the override added', async () => {
	const { dir, run } = await setupCoverageRun({ override: ['test-coverage'] });

	const result = await runVerificationGates({ run, coverage: false, checkpoint: 'verify-tests' });

	// the step asked for no coverage, and the override scheduled the gate anyway —
	// so the per-file check follows the gate that ran, not the parameter
	expect(result.error ?? '').toContain('changed-file-execution: 1 changed file(s) never executed under the tests: src/feature.ts');
	expect(result.failedFamilies).toStrictEqual(['changed-files-executed']);
	expect(readGateLog({ dir })).toStrictEqual(['root coverage']);
});

test('runVerificationGates: no coverage gate ran, so the changed-files-executed check is skipped', async () => {
	const { dir, run } = await setupCoverageRun({ override: ['check'] });

	const result = await runVerificationGates({ run, coverage: true, checkpoint: 'verify-tests' });

	// the same never-executed file as the case above, and no verdict about it:
	// the step asked for coverage, the override dropped the gate, and a check
	// with no report to read must not fail the checkpoint
	expect(result.error).toBe(undefined);
	expect(result.failedFamilies).toStrictEqual([]);
	expect(readGateLog({ dir })).toStrictEqual(['root check']);
});

test('runVerificationGates: an edited ledger test is restored even where the checkpoint runs no gates', async () => {
	const { dir, live, progress, run } = await setupLedgerRun();

	const result = await runVerificationGates({ run, coverage: false, checkpoint: 'verify-tests' });

	// the lock protects the ledger itself rather than the gates about to run,
	// so "off" — which runs nothing, generate included — does not skip it
	expect(readFileSync(live, 'utf8')).toBe(locked);
	expect(progress.some((message) => message.includes(ledgerPath))).toBe(true);
	expect(readGateLog({ dir })).toStrictEqual([]);
	expect(result.error).toBe(undefined);
});
