import { expect, test } from '@jest/globals';
import { WritersReport } from '#src/contracts/index.ts';

const report = { status: 'complete', changedFiles: [], summary: 'wrote tests', failures: [] };

test('WritersReport wraps the batch reports the write-tests step persists, and rejects anything else', () => {
	const parsed = WritersReport.parse({ reports: [report, { ...report, summary: 'second batch' }] });

	// the envelope is the whole shape — one entry per writer batch
	expect(parsed.reports.map((entry) => entry.summary)).toStrictEqual(['wrote tests', 'second batch']);
	// a step that ran no batches still parses as the same shape
	expect(WritersReport.parse({ reports: [] }).reports).toStrictEqual([]);
	// the array is required — a reader must not read a bare object as an empty run
	expect(WritersReport.safeParse({}).success).toBe(false);
	// entries are WorkReports, so a step record holding some other shape is not a writers step
	expect(WritersReport.safeParse({ reports: [{ outcome: 'resolved', remainingSiteKeys: [], rationale: [] }] }).success).toBe(false);
});

test('WritersReport tells a writers step apart from the other step reports a manifest stores', () => {
	const asWritersStep = WritersReport.safeParse(report);

	// a work step stores a bare WorkReport, which names no batches — recognising
	// steps by shape only works if this one does not answer to the envelope
	expect(asWritersStep.success).toBe(false);
	// nor does a coordinator step's PhaseReport
	expect(WritersReport.safeParse({ runId: '20260808-120000-a1b2c3' }).success).toBe(false);
	// and `reports` names a list — a lone report is not silently wrapped into one
	expect(WritersReport.safeParse({ reports: report }).success).toBe(false);
});

test('WritersReport normalizes each batch on the way through, so a reader never handles a raw entry', () => {
	const parsed = WritersReport.parse({
		reports: [
			{
				status: 'complete',
				changedFiles: [{ path: 'src/a.unit.test.ts', summary: 'covered the empty case', linesAdded: 12 }],
				summary: 'wrote tests',
				friction: [{ area: 'scope', detail: 'an area the agent invented' }],
			},
		],
	});

	// the entries are full WorkReports, so the omitted failures list, the
	// volunteered extra key and the invented friction area are all settled here
	// rather than by whoever reads the step record back
	expect(parsed.reports[0]).toStrictEqual({
		status: 'complete',
		changedFiles: [{ path: 'src/a.unit.test.ts', summary: 'covered the empty case' }],
		summary: 'wrote tests',
		failures: [],
		friction: [{ area: 'other', detail: 'an area the agent invented' }],
	});
});

test('WritersReport keeps only the batch list, dropping anything the step volunteered beside it', () => {
	const parsed = WritersReport.parse({ reports: [report], step: 'write-tests', attempts: 2 });

	// the envelope is the contract's whole surface — a reader that sees these
	// fields on one manifest must not come to depend on them
	expect(parsed).toStrictEqual({ reports: [report] });
});
