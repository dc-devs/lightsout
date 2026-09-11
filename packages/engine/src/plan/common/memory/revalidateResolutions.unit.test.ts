import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, test } from '@jest/globals';
import { GapArea, GapCheckLens, GapOutcome, type GradeFindingRecord, GradeFindingStatus, type GradeMemory } from '#src/contracts/index.ts';
import { revalidateResolutions } from '#src/plan/common/memory/revalidateResolutions.ts';
import { freshCwd } from '#tests/helpers/freshCwd.ts';

/** When the pass that closed each record ran, and when the pass under test runs. */
const resolvedAt = '2026-01-01T00:00:00.000Z';
const passAt = '2026-02-02T00:00:00.000Z';

/** A line of the current plan, long enough to stand as a citation the engine can confirm. */
const survivingLine = 'The judge that times out leaves its own record open and blocking.';
/** A line an earlier pass cited that a later edit deleted from the plan. */
const deletedLine = 'The judge that times out returns the answer the last pass recorded.';

const phaseText = `# Phase 1\n\n## Decision Log\n\n${survivingLine}\n`;

/** One record as an earlier pass left it: a human's question, closed by a cited answer. */
const recordOf = (overrides: Partial<GradeFindingRecord> = {}): GradeFindingRecord => ({
	id: 'f1',
	phase: 'phase-1-reader.md',
	lens: GapCheckLens.Decisions,
	area: GapArea.OmittedDecision,
	gap: 'the plan picks no failure mode',
	decision: 'what to return when the judge times out',
	options: [],
	firstSeen: resolvedAt,
	lastSeen: resolvedAt,
	status: GradeFindingStatus.Resolved,
	disposition: GapOutcome.NeedsAHuman,
	humanDecision: 'pick the failure mode',
	resolution: { answerAt: survivingLine, verifiedAt: resolvedAt },
	observations: [],
	resolutions: [],
	reopened: [],
	...overrides,
});

/** The current plan text, a workspace to resolve path citations against, and the memory to revalidate. */
const setupRevalidation = async ({ findings, onDisk = [] }: { findings: GradeFindingRecord[]; onDisk?: string[] }) => {
	const cwd = await freshCwd();

	for (const path of onDisk) {
		await mkdir(join(cwd, 'src'), { recursive: true });
		await writeFile(join(cwd, path), 'export const answer = 1;\n', 'utf8');
	}

	const memory: GradeMemory = {
		planName: 'demo',
		findings,
		nextFindingNumber: findings.length + 1,
		updatedAt: resolvedAt,
	};

	return {
		params: {
			cwd,
			files: [{ path: join(cwd, 'phase-1-reader.md'), text: phaseText }],
			memory,
			at: passAt,
		},
	};
};

/** A second plan file, present in the deliverable but no longer stating the answer an earlier pass cited there. */
const writerText = '# Phase 2\n\n## Decision Log\n\nThe writer stores each record as its judge left it.\n';

/** A two-file plan and the memory to revalidate — a grouped record's citations are each checked against their own file. */
const setupGroupedRevalidation = async ({ findings }: { findings: GradeFindingRecord[] }) => {
	const cwd = await freshCwd();

	const memory: GradeMemory = {
		planName: 'demo',
		findings,
		nextFindingNumber: findings.length + 1,
		updatedAt: resolvedAt,
	};

	return {
		params: {
			cwd,
			files: [
				{ path: join(cwd, 'phase-1-reader.md'), text: phaseText },
				{ path: join(cwd, 'phase-2-writer.md'), text: writerText },
			],
			memory,
			at: passAt,
		},
	};
};

/** The record the run returned under a given id — every member survives the fold, so a missing one is worth reading. */
const recordIn = ({ memory, id }: { memory: GradeMemory; id: string }): GradeFindingRecord | undefined => memory.findings.find((record) => record.id === id);

describe('revalidateResolutions', () => {
	test('a resolved record reopens when its citation leaves the plan', async () => {
		const { params } = await setupRevalidation({
			findings: [recordOf({ resolution: { answerAt: deletedLine, verifiedAt: resolvedAt } })],
		});

		const result = await revalidateResolutions(params);

		// a resolution is a claim about the plan's text; once the text no longer
		// says it, the question is unanswered again and must block until a judge
		// finds the answer somewhere else
		expect(recordIn({ memory: result.memory, id: 'f1' })).toEqual(
			expect.objectContaining({
				status: GradeFindingStatus.Open,
				disposition: GapOutcome.NeedsAHuman,
				resolution: undefined,
				lastSeen: passAt,
				reopened: [
					expect.objectContaining({
						at: passAt,
						priorStatus: GradeFindingStatus.Resolved,
						reason: expect.stringContaining(deletedLine),
					}),
				],
			}),
		);
		// and the run names what it reopened, so the same pass knows to re-judge it
		expect(result.reopened).toStrictEqual(['f1']);
	});

	test('a record reopened again keeps every earlier reopen entry ahead of the new one', async () => {
		const earlier = { at: resolvedAt, reason: 'an earlier judge ruled the question open again', priorStatus: GradeFindingStatus.Noted };
		const { params } = await setupRevalidation({
			findings: [recordOf({ reopened: [earlier], resolution: { answerAt: deletedLine, verifiedAt: resolvedAt } })],
		});

		const result = await revalidateResolutions(params);

		// the history is how a human reads why a question keeps coming back, so a
		// fresh reopen is appended to it rather than replacing it
		expect(recordIn({ memory: result.memory, id: 'f1' })?.reopened).toEqual([
			earlier,
			{ at: passAt, priorStatus: GradeFindingStatus.Resolved, reason: expect.stringContaining(deletedLine) },
		]);
	});

	test('revalidation touches only a resolved record whose citation is gone', async () => {
		const { params } = await setupRevalidation({
			findings: [
				recordOf(),
				recordOf({ id: 'f2', resolution: { answerAt: 'src/answer.ts', verifiedAt: resolvedAt } }),
				// closed on creation by a judge, never carrying a verified citation —
				// so a citation the plan no longer holds says nothing about it
				recordOf({
					id: 'f3',
					status: GradeFindingStatus.Noted,
					disposition: GapOutcome.AlreadyAnswered,
					humanDecision: undefined,
					answerAt: deletedLine,
					resolution: undefined,
				}),
				recordOf({ id: 'f4', status: GradeFindingStatus.Open, resolution: undefined }),
			],
			onDisk: ['src/answer.ts'],
		});

		const result = await revalidateResolutions(params);

		// a quote the plan still states and a path still on disk are both good
		// evidence, so neither closure is disturbed
		expect(recordIn({ memory: result.memory, id: 'f1' })).toEqual(
			expect.objectContaining({
				status: GradeFindingStatus.Resolved,
				resolution: { answerAt: survivingLine, verifiedAt: resolvedAt },
				lastSeen: resolvedAt,
				reopened: [],
			}),
		);
		expect(recordIn({ memory: result.memory, id: 'f2' })).toEqual(
			expect.objectContaining({
				status: GradeFindingStatus.Resolved,
				resolution: { answerAt: 'src/answer.ts', verifiedAt: resolvedAt },
				reopened: [],
			}),
		);
		// a noted record has its own reopen path through the judge; revalidation is
		// not it
		expect(recordIn({ memory: result.memory, id: 'f3' })).toEqual(
			expect.objectContaining({ status: GradeFindingStatus.Noted, lastSeen: resolvedAt, reopened: [] }),
		);
		expect(recordIn({ memory: result.memory, id: 'f4' })).toEqual(
			expect.objectContaining({ status: GradeFindingStatus.Open, lastSeen: resolvedAt, reopened: [] }),
		);
		expect(result.reopened).toStrictEqual([]);
	});

	test("reopens a grouped record when any one location's citation is gone", async () => {
		const { params } = await setupGroupedRevalidation({
			findings: [
				recordOf({
					observations: [
						{
							phase: 'phase-1-reader.md',
							lens: GapCheckLens.Decisions,
							area: GapArea.OmittedDecision,
							gap: 'the plan picks no failure mode',
							decision: 'what to return when the judge times out',
							options: [],
						},
						{
							phase: 'phase-2-writer.md',
							lens: GapCheckLens.Wiring,
							area: GapArea.PhaseSeamMismatch,
							gap: 'the writer never says what a timed-out judge leaves behind',
							decision: 'what to return when the judge times out',
							options: [],
						},
					],
					resolution: undefined,
					resolutions: [
						{ phase: 'phase-1-reader.md', answerAt: survivingLine, verifiedAt: resolvedAt },
						{ phase: 'phase-2-writer.md', answerAt: deletedLine, verifiedAt: resolvedAt },
					],
				}),
			],
		});

		const result = await revalidateResolutions(params);

		// the first file still states its answer, but a group whose repair came
		// undone in one place is unresolved as a whole — so every stored
		// resolution goes, and the reason says which location lost its citation
		expect(recordIn({ memory: result.memory, id: 'f1' })).toEqual(
			expect.objectContaining({
				status: GradeFindingStatus.Open,
				disposition: GapOutcome.NeedsAHuman,
				resolution: undefined,
				resolutions: [],
				lastSeen: passAt,
				reopened: [
					expect.objectContaining({
						at: passAt,
						priorStatus: GradeFindingStatus.Resolved,
						reason: expect.stringContaining('phase-2-writer.md'),
					}),
				],
			}),
		);
		expect(result.reopened).toStrictEqual(['f1']);
	});
});
