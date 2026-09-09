import { existsSync, readFileSync } from 'node:fs';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, test } from '@jest/globals';
import { StandardsSeverity, type StandardsSnapshot } from '#src/contracts/index.ts';
import { writeRunStandardsBaseline } from '#src/runState/index.ts';

const setupBaselineWrite = async () => {
	const cwd = await mkdtemp(join(tmpdir(), 'lightsout-run-baseline-'));
	const runId = 'run-baseline';
	const runDir = join(cwd, '.lightsout', 'runs', runId);
	const baselinePath = join(runDir, 'standards-baseline.json');

	/**
	 * Bytes already sitting at the baseline path, so a write can be seen
	 * replacing something rather than landing on an empty folder.
	 */
	const plantStaleBaseline = async ({ body }: { body: string }) => {
		await mkdir(runDir, { recursive: true });
		await writeFile(baselinePath, body, 'utf8');
	};

	const snapshot: StandardsSnapshot = {
		at: '2026-08-19T12:30:45.123Z',
		path: '.',
		findings: [
			{
				rule: 'size-file',
				severity: StandardsSeverity.Blocking,
				siteKey: 'size-file:src/a/big.ts',
				files: [{ path: 'src/a/big.ts' }],
				detail: '420 lines',
			},
		],
		notes: ['1 file scanned'],
	};

	return { cwd, runId, runDir, baselinePath, snapshot, plantStaleBaseline, runDirExistedBefore: existsSync(runDir) };
};

describe('writeRunStandardsBaseline', () => {
	test('creates the run folder and writes the snapshot as tab-indented JSON with a trailing newline', async () => {
		const { cwd, runId, baselinePath, snapshot, runDirExistedBefore } = await setupBaselineWrite();

		await writeRunStandardsBaseline({ cwd, runId, snapshot });

		const raw = readFileSync(baselinePath, 'utf8');

		// the first run to reach clean-slate has no run folder yet, so the writer
		// has to make one rather than throw
		expect(runDirExistedBefore).toBe(false);
		// the same bytes the repo-level snapshot uses: tab-indented, keys in
		// declaration order, one trailing newline
		expect(raw.startsWith('{\n\t"at": "2026-08-19T12:30:45.123Z",\n\t"path": ".",')).toBe(true);
		expect(raw.endsWith('}\n')).toBe(true);
		expect(JSON.parse(raw)).toStrictEqual(snapshot);
	});

	test('replaces a baseline already at the path instead of adding to it', async () => {
		const { cwd, runId, baselinePath, snapshot, plantStaleBaseline } = await setupBaselineWrite();
		await plantStaleBaseline({ body: '{\n\t"at": "2026-01-01T00:00:00.000Z",\n\t"path": "packages/engine"\n}\n' });

		await writeRunStandardsBaseline({ cwd, runId, snapshot });

		const raw = readFileSync(baselinePath, 'utf8');

		// there is no guard against an existing file, deliberately — so the write
		// itself has to leave one whole snapshot, not two concatenated ones and
		// not a refusal
		expect(JSON.parse(raw)).toStrictEqual(snapshot);
		expect(raw.endsWith('}\n')).toBe(true);
	});

	test('writes each run’s baseline into that run’s own folder', async () => {
		const { cwd, snapshot } = await setupBaselineWrite();

		await writeRunStandardsBaseline({ cwd, runId: 'run-phase-two', snapshot });

		const wroteUnderTheRunId = existsSync(join(cwd, '.lightsout', 'runs', 'run-phase-two', 'standards-baseline.json'));

		// the run id has to reach the path, or every run in a repo would share
		// one comparison point and a phase child would measure its parent's tree
		expect(wroteUnderTheRunId).toBe(true);
	});
});
