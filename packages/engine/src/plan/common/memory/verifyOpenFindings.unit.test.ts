import { describe, expect, test } from '@jest/globals';
import { GapArea } from '#src/contracts/plan/grade/GapArea.ts';
import { GapOutcome } from '#src/contracts/plan/grade/GapOutcome.ts';
import { GradeFindingStatus } from '#src/contracts/plan/memory/GradeFindingStatus.ts';
import { verifyOpenFindings } from '#src/plan/common/memory/verifyOpenFindings.ts';
import {
	firstPhaseLine,
	overviewLine,
	overviewText,
	recordIn,
	recordOf,
	secondObservationDecision,
	secondObservationGap,
	secondPhaseLine,
	setupRecheck,
	twoLocationRecordOf,
} from '#tests/helpers/recheckFindings.ts';

describe('verifyOpenFindings', () => {
	test('a record closes on a cited already-answered and on nothing else', async () => {
		const { params } = await setupRecheck({
			findings: [recordOf(), recordOf({ id: 'f2', phase: 'phase-2-judge.md', gap: 'the plan names no owner for the queue', humanDecision: 'pick the owner' })],
			answers: {
				'the plan picks no failure mode': { outcome: GapOutcome.AlreadyAnswered, answerAt: firstPhaseLine },
				'the plan names no owner for the queue': { outcome: GapOutcome.NeedsAHuman, humanDecision: 'pick the owner' },
			},
		});

		const result = await verifyOpenFindings(params);

		// a cited already-answered is the one answer that closes a record, and the
		// closure records where the plan states the answer and when it was checked —
		// one entry per location, and never again in the legacy single field
		expect(recordIn({ memory: result.memory, id: 'f1' })).toEqual(
			expect.objectContaining({
				status: GradeFindingStatus.Resolved,
				resolution: undefined,
				resolutions: [{ phase: 'phase-1-reader.md', answerAt: firstPhaseLine, verifiedAt: '2026-02-02T00:00:00.000Z' }],
			}),
		);
		// a judge restating the outstanding decision closes nothing
		expect(recordIn({ memory: result.memory, id: 'f2' })).toEqual(expect.objectContaining({ status: GradeFindingStatus.Open, resolution: undefined }));
	});

	test('a citation the plan text does not contain leaves the record open and says so', async () => {
		const invented = 'The plan settles the failure mode in a row nobody ever wrote.';
		const { params } = await setupRecheck({
			findings: [recordOf(), recordOf({ id: 'f2', gap: 'the plan names no owner for the queue' })],
			answers: {
				'the plan picks no failure mode': { outcome: GapOutcome.AlreadyAnswered, answerAt: invented },
				// present in the plan text, but far too short to settle anything
				'the plan names no owner for the queue': { outcome: GapOutcome.AlreadyAnswered, answerAt: 'Decision Log' },
			},
		});

		const result = await verifyOpenFindings(params);

		// an invented quote and a heading-sized one are both rubber stamps: neither
		// may turn an unresolved blocker into a closed record
		expect(recordIn({ memory: result.memory, id: 'f1' })?.status).toBe(GradeFindingStatus.Open);
		expect(recordIn({ memory: result.memory, id: 'f2' })?.status).toBe(GradeFindingStatus.Open);
		expect(recordIn({ memory: result.memory, id: 'f1' })?.resolution).toBe(undefined);
		expect(recordIn({ memory: result.memory, id: 'f2' })?.resolution).toBe(undefined);
		// and the refusal names the citation it refused, so the terminal can say why
		expect(result.refusals.get('f1')).toEqual(expect.stringContaining(invented));
		expect(result.refusals.get('f2')).toEqual(expect.stringContaining('Decision Log'));
	});

	test('a path citation closes the record only when the file is on disk', async () => {
		const { params } = await setupRecheck({
			findings: [recordOf(), recordOf({ id: 'f2', gap: 'the plan names no owner for the queue' })],
			answers: {
				'the plan picks no failure mode': { outcome: GapOutcome.AlreadyAnswered, answerAt: 'src/answer.ts' },
				'the plan names no owner for the queue': { outcome: GapOutcome.AlreadyAnswered, answerAt: 'src/ghost.ts' },
			},
			onDisk: ['src/answer.ts'],
		});

		const result = await verifyOpenFindings(params);

		// a path is the one citation checked against the repository rather than the
		// plan text, which is why neither of these is quoted anywhere in the plan
		expect(recordIn({ memory: result.memory, id: 'f1' })).toEqual(
			expect.objectContaining({
				status: GradeFindingStatus.Resolved,
				resolutions: [{ phase: 'phase-1-reader.md', answerAt: 'src/answer.ts', verifiedAt: '2026-02-02T00:00:00.000Z' }],
			}),
		);
		expect(recordIn({ memory: result.memory, id: 'f2' })?.status).toBe(GradeFindingStatus.Open);
		expect(result.refusals.get('f2')).toEqual(expect.stringContaining('src/ghost.ts'));
	});

	test('a judge that did not answer leaves the record open and blocking', async () => {
		const { params } = await setupRecheck({
			findings: [recordOf(), recordOf({ id: 'f2', gap: 'the plan names no owner for the queue' })],
			answers: {
				'the plan picks no failure mode': 'failed',
				'the plan names no owner for the queue': 'rate-limited',
			},
		});

		const result = await verifyOpenFindings(params);

		// a spawn that produced no answer is not evidence of anything, so both
		// records keep the disposition that blocks the grade
		expect(recordIn({ memory: result.memory, id: 'f1' })).toEqual(
			expect.objectContaining({ status: GradeFindingStatus.Open, disposition: GapOutcome.NeedsAHuman }),
		);
		expect(recordIn({ memory: result.memory, id: 'f2' })).toEqual(
			expect.objectContaining({ status: GradeFindingStatus.Open, disposition: GapOutcome.NeedsAHuman }),
		);
		// no citation was refused — nothing was cited
		expect(result.refusals.get('f1')).toBe(undefined);
		// and the wall is reported, so the pass can park rather than retry
		expect(result.rateLimited).toBe(true);
	});

	test('a record labelled with the overview or a vanished phase is judged against every plan file', async () => {
		const { params, invocations } = await setupRecheck({
			findings: [
				recordOf({ phase: 'overview.md', lens: undefined, area: GapArea.MissingDocumentation }),
				recordOf({ id: 'f2', phase: 'gone.md', gap: 'the plan names no owner for the queue' }),
			],
			answers: {
				// the answer now lives in the second phase, which is not the file
				// either record is labelled with
				'the plan picks no failure mode': { outcome: GapOutcome.AlreadyAnswered, answerAt: secondPhaseLine },
				'the plan names no owner for the queue': { outcome: GapOutcome.NeedsAHuman, humanDecision: 'pick the owner' },
			},
			overview: overviewText,
		});

		const result = await verifyOpenFindings(params);

		// a record whose label names no deliverable file is checked against the
		// whole plan, so it can be answered wherever the answer moved to
		expect(invocations.length).toBe(2);
		expect(invocations.every(({ prompt }) => prompt.includes(overviewLine) && prompt.includes(firstPhaseLine) && prompt.includes(secondPhaseLine))).toBe(true);
		expect(recordIn({ memory: result.memory, id: 'f1' })?.status).toBe(GradeFindingStatus.Resolved);
		// and one that is still unanswered stays open rather than being closed by
		// the wider reading
		expect(recordIn({ memory: result.memory, id: 'f2' })?.status).toBe(GradeFindingStatus.Open);
	});

	test('a pass that already met the rate-limit wall asks nothing and closes nothing', async () => {
		const { params, invocations } = await setupRecheck({
			findings: [recordOf(), recordOf({ id: 'f2', gap: 'the plan names no owner for the queue' })],
			answers: { 'the plan picks no failure mode': { outcome: GapOutcome.AlreadyAnswered, answerAt: firstPhaseLine } },
			skipReason: 'the reader fan-out was rate limited',
		});

		const result = await verifyOpenFindings(params);

		// a wall met by launching another dozen spawns into it is still a wall, and
		// a record nobody asked about is not a record anybody answered — even one
		// whose answer was sitting in the plan the whole time
		expect(invocations).toStrictEqual([]);
		expect(result.memory.findings.map((record) => record.status)).toStrictEqual([GradeFindingStatus.Open, GradeFindingStatus.Open]);
		expect(result.rateLimited).toBe(false);
	});

	test('an already-answered that cites nothing leaves the record open and names the location', async () => {
		const { params } = await setupRecheck({
			findings: [recordOf()],
			answers: { 'the plan picks no failure mode': { outcome: GapOutcome.AlreadyAnswered } },
		});

		const result = await verifyOpenFindings(params);

		// a dismissal with no citation is the one the engine can least check, so it
		// closes nothing and the refusal says which plan file went uncited
		expect(recordIn({ memory: result.memory, id: 'f1' })).toEqual(expect.objectContaining({ status: GradeFindingStatus.Open, resolutions: [] }));
		expect(result.refusals.get('f1')).toEqual(expect.stringContaining('phase-1-reader.md'));
	});

	test('asks no judge about a pending record, which needs judging rather than re-verification', async () => {
		const { params, invocations } = await setupRecheck({
			findings: [
				recordOf({
					status: GradeFindingStatus.Pending,
					disposition: undefined,
					humanDecision: undefined,
					unjudgedReason: 'the judge fan-out stopped before this finding was judged',
				}),
			],
			answers: { 'the plan picks no failure mode': { outcome: GapOutcome.AlreadyAnswered, answerAt: firstPhaseLine } },
		});

		const result = await verifyOpenFindings(params);

		// nobody has ruled on a pending question yet, so asking whether the plan now
		// answers it is the wrong question — and an answer sitting in the plan must
		// not close a finding no judge ever settled
		expect(invocations).toStrictEqual([]);
		expect(recordIn({ memory: result.memory, id: 'f1' })).toEqual(expect.objectContaining({ status: GradeFindingStatus.Pending, resolutions: [] }));
	});

	test('keeps a two-location record open when only one location is confirmed', async () => {
		const { params } = await setupRecheck({
			findings: [twoLocationRecordOf()],
			answers: {
				'the plan picks no failure mode': { outcome: GapOutcome.AlreadyAnswered, answerAt: firstPhaseLine },
				// a real line of the plan, but of the FIRST file — so it is no evidence
				// that the second occurrence was repaired
				[secondObservationGap]: { outcome: GapOutcome.AlreadyAnswered, answerAt: firstPhaseLine },
			},
		});

		const result = await verifyOpenFindings(params);

		// fixing one occurrence never closes the others: nothing is stored until
		// every location is confirmed against its own text
		expect(recordIn({ memory: result.memory, id: 'f1' })).toEqual(expect.objectContaining({ status: GradeFindingStatus.Open, resolutions: [] }));
		// and the refusal names the location it came from, so a human knows where
		// the repair is still missing
		expect(result.refusals.get('f1')).toEqual(expect.stringContaining('phase-2-judge.md'));
	});

	test('resolves a two-location record only once every location is confirmed', async () => {
		const { params } = await setupRecheck({
			findings: [twoLocationRecordOf()],
			answers: {
				'the plan picks no failure mode': { outcome: GapOutcome.AlreadyAnswered, answerAt: firstPhaseLine },
				[secondObservationGap]: { outcome: GapOutcome.AlreadyAnswered, answerAt: secondPhaseLine },
			},
		});

		const result = await verifyOpenFindings(params);

		// one stored citation per location, each the one confirmed against that
		// location's own plan text
		const record = recordIn({ memory: result.memory, id: 'f1' });
		expect(record?.status).toBe(GradeFindingStatus.Resolved);
		expect(record?.resolutions).toHaveLength(2);
		expect(record?.resolutions).toEqual(
			expect.arrayContaining([
				{ phase: 'phase-1-reader.md', answerAt: firstPhaseLine, verifiedAt: '2026-02-02T00:00:00.000Z' },
				{ phase: 'phase-2-judge.md', answerAt: secondPhaseLine, verifiedAt: '2026-02-02T00:00:00.000Z' },
			]),
		);
	});

	test("asks one judge per location with that location's own plan text and wording", async () => {
		const { params, invocations } = await setupRecheck({
			findings: [twoLocationRecordOf()],
			answers: {
				'the plan picks no failure mode': { outcome: GapOutcome.NeedsAHuman, humanDecision: 'pick the failure mode' },
				[secondObservationGap]: { outcome: GapOutcome.NeedsAHuman, humanDecision: 'pick the timeout' },
			},
		});

		await verifyOpenFindings(params);

		// the fan-out starts spawns in any order, so each is found by the plan text it carries
		const firstSpawn = invocations.find(({ prompt }) => prompt.includes(firstPhaseLine));
		const secondSpawn = invocations.find(({ prompt }) => prompt.includes(secondPhaseLine));
		expect(invocations).toHaveLength(2);
		// the first location's judge reads only its own file and its own wording
		expect(firstSpawn?.prompt).toEqual(expect.stringContaining('the plan picks no failure mode'));
		expect(firstSpawn?.prompt).not.toEqual(expect.stringContaining(secondPhaseLine));
		expect(firstSpawn?.prompt).not.toEqual(expect.stringContaining(secondObservationGap));
		// the second location's judge is asked in its own reader's words — never
		// the representative's, which were written about another file
		expect(secondSpawn?.prompt).toEqual(expect.stringContaining(secondObservationGap));
		expect(secondSpawn?.prompt).toEqual(expect.stringContaining(secondObservationDecision));
		expect(secondSpawn?.prompt).not.toEqual(expect.stringContaining(firstPhaseLine));
		expect(secondSpawn?.prompt).not.toEqual(expect.stringContaining('the plan picks no failure mode'));
		expect(secondSpawn?.prompt).not.toEqual(expect.stringContaining('what to return when the judge times out'));
	});

	test('asks only about records that lost coverage and records no judge has ever answered', async () => {
		const { params, invocations } = await setupRecheck({
			findings: [
				recordOf({ lastRecheckedAt: '2026-01-15T00:00:00.000Z' }),
				recordOf({ id: 'f2', phase: 'phase-2-judge.md', gap: 'the plan names no owner for the queue', humanDecision: 'pick the owner' }),
				recordOf({
					id: 'f3',
					phase: 'phase-2-judge.md',
					gap: 'the plan sets no limit on the retry count',
					humanDecision: 'pick the retry limit',
					lastRecheckedAt: '2026-01-15T00:00:00.000Z',
				}),
			],
			answers: {
				'the plan picks no failure mode': { outcome: GapOutcome.NeedsAHuman, humanDecision: 'pick the failure mode' },
				'the plan names no owner for the queue': { outcome: GapOutcome.NeedsAHuman, humanDecision: 'pick the owner' },
				// an answer that would close the third record, so the run only leaves it
				// open by never asking about it at all
				'the plan sets no limit on the retry count': { outcome: GapOutcome.AlreadyAnswered, answerAt: secondPhaseLine },
			},
			invalidated: ['phase-1-reader.md'],
		});

		const result = await verifyOpenFindings(params);

		// the first lost its location's coverage and the second was never asked, so
		// both are worth a judge; the third kept its coverage and carries a stamp
		expect(invocations).toHaveLength(2);
		expect(invocations.some(({ prompt }) => prompt.includes('the plan picks no failure mode'))).toBe(true);
		expect(invocations.some(({ prompt }) => prompt.includes('the plan names no owner for the queue'))).toBe(true);
		expect(invocations.some(({ prompt }) => prompt.includes('the plan sets no limit on the retry count'))).toBe(false);
		// and a record nobody asked about is not a record anybody answered: it keeps
		// the disposition that blocks the grade, and its earlier stamp
		expect(recordIn({ memory: result.memory, id: 'f3' })).toEqual(
			expect.objectContaining({
				status: GradeFindingStatus.Open,
				disposition: GapOutcome.NeedsAHuman,
				resolutions: [],
				lastRecheckedAt: '2026-01-15T00:00:00.000Z',
			}),
		);
	});

	test('stamps a record as rechecked whatever the judge answered', async () => {
		const invented = 'The plan settles the failure mode in a row nobody ever wrote.';
		const { params } = await setupRecheck({
			findings: [recordOf()],
			answers: { 'the plan picks no failure mode': { outcome: GapOutcome.AlreadyAnswered, answerAt: invented } },
			invalidated: ['phase-1-reader.md'],
		});

		const result = await verifyOpenFindings(params);

		// the citation was refused, so the record stays open — but it WAS asked, and
		// the stamp is what stops the next pass paying for the same question again
		expect(recordIn({ memory: result.memory, id: 'f1' })).toEqual(
			expect.objectContaining({ status: GradeFindingStatus.Open, resolutions: [], lastRecheckedAt: '2026-02-02T00:00:00.000Z' }),
		);
		expect(result.refusals.get('f1')).toEqual(expect.stringContaining(invented));
	});

	test('a record located outside the plan files is asked every pass', async () => {
		const { params, invocations } = await setupRecheck({
			findings: [
				recordOf({
					phase: 'overview.md',
					lens: undefined,
					area: GapArea.MissingDocumentation,
					lastRecheckedAt: '2026-01-15T00:00:00.000Z',
				}),
			],
			answers: { 'the plan picks no failure mode': { outcome: GapOutcome.NeedsAHuman, humanDecision: 'pick the failure mode' } },
			overview: overviewText,
			invalidated: [],
		});

		const result = await verifyOpenFindings(params);

		// no coverage is recorded for a location that is not a plan file, so nothing
		// can say that location still stands — stamped once, this record would
		// otherwise block approval forever
		expect(invocations).toHaveLength(1);
		expect(invocations[0]?.prompt).toEqual(expect.stringContaining('the plan picks no failure mode'));
		expect(recordIn({ memory: result.memory, id: 'f1' })).toEqual(
			expect.objectContaining({ status: GradeFindingStatus.Open, lastRecheckedAt: '2026-02-02T00:00:00.000Z' }),
		);
	});
});
