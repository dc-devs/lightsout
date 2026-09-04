import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { describe, expect, test } from '@jest/globals';
import { sha256 } from '#src/common/utils/sha256.ts';
import type { LedgerTestRecord } from '#src/contracts/index.ts';
import { ledgerCopyPath } from '#src/pipeline/common/utils/ledgerCopyPath.ts';
import { restoreLedgerTests } from '#src/pipeline/common/utils/restoreLedgerTests.ts';
import type { PipelineRun } from '#src/pipeline/PipelineRun.ts';

const runId = 'run-1';
const path = 'src/widget.unit.test.ts';
const locked = "test('widget: renders', () => {});\n";

/** A repo holding one locked ledger test file, with the run's copy already taken. */
const setupLockedRun = () => {
	const cwd = mkdtempSync(join(tmpdir(), 'lightsout-ledger-lock-'));
	const live = join(cwd, path);
	const copy = ledgerCopyPath({ cwd, runId, path });
	const record: LedgerTestRecord = { path, testNames: ['widget: renders'], sha256: sha256({ content: locked }) };

	for (const target of [live, copy]) {
		mkdirSync(dirname(target), { recursive: true });
		writeFileSync(target, locked);
	}

	const run = { cwd, current: () => ({ runId, ledgerTests: [record] }) };

	return { run: run as unknown as PipelineRun, live };
};

describe('restoreLedgerTests', () => {
	test('an untouched ledger test file is left alone and reported as untouched', async () => {
		const { run, live } = setupLockedRun();

		const { restored } = await restoreLedgerTests({ run });

		// nothing to put back, so the verify step announces nothing
		expect(restored).toStrictEqual([]);
		expect(readFileSync(live, 'utf8')).toBe(locked);
	});

	test('an edited ledger test file is put back and reported', async () => {
		const { run, live } = setupLockedRun();

		writeFileSync(live, "test('widget: renders', () => { expect(true).toBe(true); });\n");

		const { restored } = await restoreLedgerTests({ run });

		// the party being verified never edits the verifier: the gates that follow
		// run against the file the ledger writer produced
		expect(restored).toStrictEqual([path]);
		expect(readFileSync(live, 'utf8')).toBe(locked);
	});

	test('a deleted ledger test file is written back from the copy', async () => {
		const { run, live } = setupLockedRun();

		rmSync(live);

		const { restored } = await restoreLedgerTests({ run });

		// deleting the test is the same move as editing it, and gets the same answer
		expect(restored).toStrictEqual([path]);
		expect(readFileSync(live, 'utf8')).toBe(locked);
	});

	test('a run with no ledger tests touches nothing', async () => {
		const cwd = mkdtempSync(join(tmpdir(), 'lightsout-ledger-lock-'));
		const run = { cwd, current: () => ({ runId, ledgerTests: [] }) } as unknown as PipelineRun;

		// a plan with no ledger carries no lock, and the check is a no-op
		expect(await restoreLedgerTests({ run })).toStrictEqual({ restored: [] });
	});
});
