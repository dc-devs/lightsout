import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, test } from '@jest/globals';
import { StandardsSeverity, type StandardsSnapshot } from '#src/contracts/index.ts';
import { readRunStandardsBaseline, writeRunStandardsBaseline } from '#src/runState/index.ts';

const setupBaseline = async () => {
	const cwd = await mkdtemp(join(tmpdir(), 'lightsout-run-baseline-'));
	const runId = 'run-baseline';

	/**
	 * Raw bytes at one run's baseline path, instead of a snapshot the writer
	 * produced. The path is stated as a literal rather than taken from the path
	 * helper: the run's own folder is the contract, and a phase child run
	 * reading its parent's comparison point would be a silent wrong answer.
	 */
	const plantBaseline = async ({ id, body }: { id: string; body: string }) => {
		await mkdir(join(cwd, '.lightsout', 'runs', id), { recursive: true });
		await writeFile(join(cwd, '.lightsout', 'runs', id, 'standards-baseline.json'), body, 'utf8');
	};

	const snapshot: StandardsSnapshot = {
		at: '2026-09-08T10:15:00.000Z',
		path: '.',
		findings: [
			{
				rule: 'size-file',
				severity: StandardsSeverity.Blocking,
				siteKey: 'size-file:src/a/big.ts',
				files: [{ path: 'src/a/big.ts' }],
				detail: '412 lines, cap 400',
				measure: 412,
			},
		],
		notes: ['37 files scanned'],
	};

	/** What a repo with standards switched off leaves behind: a real snapshot that found nothing. */
	const emptySnapshot: StandardsSnapshot = {
		at: '2026-09-08T10:20:00.000Z',
		path: '.',
		findings: [],
		notes: [],
	};

	return { cwd, runId, snapshot, emptySnapshot, plantBaseline };
};

describe('readRunStandardsBaseline', () => {
	test('reads back exactly what the writer wrote', async () => {
		const { cwd, runId, snapshot } = await setupBaseline();

		await writeRunStandardsBaseline({ cwd, runId, snapshot });
		const read = await readRunStandardsBaseline({ cwd, runId });

		// the measured number and the notes are what a later comparison reads;
		// dropping either would leave cleanup unable to tell a site that grew
		// from a site that merely moved
		expect(read).toStrictEqual(snapshot);
	});

	test('answers undefined for a run that has no baseline file', async () => {
		const { cwd, runId } = await setupBaseline();

		const read = await readRunStandardsBaseline({ cwd, runId });

		// the state of every run created before the baseline existed — resuming
		// one has to be possible
		expect(read).toBe(undefined);
	});

	test('answers undefined for a file that is not a snapshot, rather than throwing', async () => {
		const { cwd, plantBaseline } = await setupBaseline();

		await plantBaseline({ id: 'run-hand-edited', body: '{ not json' });
		await plantBaseline({ id: 'run-older-engine', body: JSON.stringify({ at: '2026-09-01T00:00:00.000Z', violations: [] }) });
		const unparseable = await readRunStandardsBaseline({ cwd, runId: 'run-hand-edited' });
		const olderEngine = await readRunStandardsBaseline({ cwd, runId: 'run-older-engine' });

		// a hand-edited file reads as "no comparison point"
		expect(unparseable).toBe(undefined);
		// so does one an older engine wrote: valid JSON, wrong shape
		expect(olderEngine).toBe(undefined);
	});

	test('tells a baseline that found nothing apart from having no baseline at all', async () => {
		const { cwd, runId, emptySnapshot } = await setupBaseline();

		await writeRunStandardsBaseline({ cwd, runId, snapshot: emptySnapshot });
		const read = await readRunStandardsBaseline({ cwd, runId });

		// "nothing was found" is an answer cleanup can compare against; only a
		// missing file means "no comparison point", so an empty findings list
		// must survive the round trip as an empty list rather than as undefined
		expect(read).toStrictEqual(emptySnapshot);
	});

	test('keeps every run to its own baseline, so one run never reads another run’s', async () => {
		const { cwd, snapshot } = await setupBaseline();

		await writeRunStandardsBaseline({ cwd, runId: 'run-parent', snapshot });
		const parent = await readRunStandardsBaseline({ cwd, runId: 'run-parent' });
		const child = await readRunStandardsBaseline({ cwd, runId: 'run-child' });

		// each phase of a phased plan is its own run with its own clean-slate, so
		// a baseline keyed anywhere but on the run id would hand a child run its
		// parent's pre-edit state and call the parent's edits inherited debt
		expect(parent).toStrictEqual(snapshot);
		expect(child).toBe(undefined);
	});
});
