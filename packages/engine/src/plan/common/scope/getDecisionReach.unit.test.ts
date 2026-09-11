import { describe, expect, test } from '@jest/globals';
import type { GradeDecisionLog } from '#src/contracts/index.ts';
import { getDecisionReach } from '#src/plan/common/scope/getDecisionReach.ts';

type DecisionEntry = GradeDecisionLog['rows'][number];

/** Every phase file the fixture plan has now. */
const phaseFiles = ['phase1-core.md', 'phase2-extra.md', 'phase3-final.md'];

/** One merged row's fingerprint entry. Rows given the same `question` are revisions of one another. */
const entry = ({ id, question = id, phases }: { id: string; question?: string; phases?: string[] }): DecisionEntry => ({
	sha256: `row-${id}`,
	questionSha256: `question-${question}`,
	...(phases === undefined ? {} : { phases }),
});

interface ReachSpec {
	previousRows?: DecisionEntry[];
	currentRows?: DecisionEntry[];
	/** Left out entirely, the way a pass recorded before the part existed leaves it. */
	omitPrevious?: boolean;
	/** Left out entirely, the way a pass that could not read the overview leaves it. */
	omitCurrent?: boolean;
	overviewChanged?: boolean;
	edited?: string[];
}

/** The two passes' decision-log parts and the scope facts handed beside them. By default the overview moved, its design text did not, and no phase text changed. */
const setupReach = ({ previousRows = [], currentRows = [], omitPrevious = false, omitCurrent = false, overviewChanged = true, edited = [] }: ReachSpec) => ({
	...(omitPrevious ? {} : { previous: { overview: 'design-1', rows: previousRows } }),
	...(omitCurrent ? {} : { current: { overview: 'design-1', rows: currentRows } }),
	overviewChanged,
	edited,
	phaseFiles,
});

describe('getDecisionReach', () => {
	test('a newly added row naming one phase reaches that phase even when phase text changed in the same pass', () => {
		const params = setupReach({
			previousRows: [entry({ id: 'a', phases: ['phase1-core.md'] })],
			currentRows: [entry({ id: 'a', phases: ['phase1-core.md'] }), entry({ id: 'b', phases: ['phase2-extra.md'] })],
			edited: ['phase2-extra.md'],
		});

		const reach = getDecisionReach(params);

		// the normal repair records an answer, edits the phase it concerns and syncs;
		// an added row has no earlier scope that today's edits could have cut loose,
		// and the unchanged row's phases are no part of this change
		expect(reach).toStrictEqual({ phases: ['phase2-extra.md'] });
	});

	test('unchanged rows that name no phases do not stop a changed row from being placed', () => {
		const params = setupReach({
			previousRows: [entry({ id: 'a' })],
			currentRows: [entry({ id: 'a' }), entry({ id: 'c', phases: ['phase3-final.md'] })],
		});

		const reach = getDecisionReach(params);

		expect(reach).toStrictEqual({ phases: ['phase3-final.md'] });
	});

	test('a revision reaches both the phases its predecessor named and the phases it names', () => {
		const params = setupReach({
			previousRows: [entry({ id: 'q', phases: ['phase1-core.md'] })],
			currentRows: [entry({ id: 'q', phases: ['phase1-core.md'] }), entry({ id: 'q-revised', question: 'q', phases: ['phase3-final.md'] })],
		});

		const reach = getDecisionReach(params);

		// the superseded answer was read by the phase it named, so the new answer
		// must be checked there as well as where it now points
		expect(reach).toStrictEqual({ phases: ['phase1-core.md', 'phase3-final.md'] });
	});

	test('a deleted row reaches the phases it named', () => {
		const params = setupReach({
			previousRows: [entry({ id: 'a' }), entry({ id: 'd', phases: ['phase2-extra.md'] })],
			currentRows: [entry({ id: 'a' })],
		});

		const reach = getDecisionReach(params);

		expect(reach).toStrictEqual({ phases: ['phase2-extra.md'] });
	});

	test('a row repeated verbatim is matched once per copy, so dropping one copy reaches the phases it named', () => {
		const params = setupReach({
			previousRows: [entry({ id: 'd', phases: ['phase2-extra.md'] }), entry({ id: 'd', phases: ['phase2-extra.md'] })],
			currentRows: [entry({ id: 'd', phases: ['phase2-extra.md'] })],
		});

		const reach = getDecisionReach(params);

		// rows compare as a multiset of hashes, so the surviving copy pairs with one
		// earlier copy and the other reads as deleted rather than as no change
		expect(reach).toStrictEqual({ phases: ['phase2-extra.md'] });
	});

	test.each([
		{
			previousRows: [entry({ id: 'q', phases: ['phase1-core.md'] })],
			currentRows: [entry({ id: 'q', phases: ['phase1-core.md'] }), entry({ id: 'q-revised', question: 'q', phases: ['phase3-final.md'] })],
		},
		{
			previousRows: [entry({ id: 'a' }), entry({ id: 'd', phases: ['phase2-extra.md'] })],
			currentRows: [entry({ id: 'a' })],
		},
	])("a superseded or removed row that named phases returns an error when a phase file's text also changed", ({ previousRows, currentRows }) => {
		const params = setupReach({ previousRows, currentRows, edited: ['phase2-extra.md'] });

		const reach = getDecisionReach(params);

		// the earlier scope ran along connections read from the earlier phase text,
		// and this pass's edits may have removed them
		expect(reach).toEqual({ error: expect.any(String) });
	});

	test.each([
		{
			previousRows: [entry({ id: 'a' })],
			currentRows: [entry({ id: 'a' }), entry({ id: 'e' })],
		},
		{
			previousRows: [entry({ id: 'p' })],
			currentRows: [entry({ id: 'p' }), entry({ id: 'p-revised', question: 'p', phases: ['phase2-extra.md'] })],
		},
	])('a changed row that names no phases returns an error', ({ previousRows, currentRows }) => {
		const params = setupReach({ previousRows, currentRows });

		const reach = getDecisionReach(params);

		// a row with no phases reaches the whole plan, or its reach is not known;
		// an empty phase list would read as reaching nothing
		expect(reach).toEqual({ error: expect.any(String) });
	});

	test('a changed row naming a file the plan does not have returns an error naming that file', () => {
		const params = setupReach({
			previousRows: [entry({ id: 'a' })],
			currentRows: [entry({ id: 'a' }), entry({ id: 'g', phases: ['phase9-gone.md'] })],
		});

		const reach = getDecisionReach(params);

		expect(reach).toEqual({ error: expect.stringContaining('phase9-gone.md') });
	});

	test('a change to the overview outside its Decision Log returns an error even when no decision row changed', () => {
		const rows = [entry({ id: 'a' }), entry({ id: 'b', phases: ['phase2-extra.md'] })];
		// this pass's hash of the overview without its Decision Log moved, while every row stayed put
		const params = { ...setupReach({ previousRows: rows, currentRows: rows }), current: { overview: 'design-2', rows } };

		const reach = getDecisionReach(params);

		// overview design text is context every phase shares
		expect(reach).toEqual({ error: expect.any(String) });
	});

	test('a Decision Log that moved with no row changed returns an error', () => {
		const params = setupReach({
			previousRows: [entry({ id: 'a' }), entry({ id: 'b', phases: ['phase2-extra.md'] })],
			currentRows: [entry({ id: 'b', phases: ['phase2-extra.md'] }), entry({ id: 'a' })],
		});

		const reach = getDecisionReach(params);

		// the overview's bytes moved, but no changed row explains where the change reaches
		expect(reach).toEqual({ error: expect.any(String) });
	});

	test.each([
		{ omitPrevious: true, omitCurrent: false, error: expect.stringMatching(/decision evidence/i) },
		{ omitPrevious: false, omitCurrent: true, error: expect.any(String) },
	])('a missing decision-log part on either side returns an error', ({ omitPrevious, omitCurrent, error }) => {
		const rows = [entry({ id: 'b', phases: ['phase2-extra.md'] })];
		const params = setupReach({ previousRows: rows, currentRows: rows, omitPrevious, omitCurrent });

		const reach = getDecisionReach(params);

		// a missing part compared as an empty one would read every row as added
		// or deleted, and history the pass never recorded must not be inferred
		expect(reach).toEqual({ error });
	});

	test('an unchanged overview and unchanged rows reach no phase', () => {
		const rows = [entry({ id: 'a' }), entry({ id: 'b', phases: ['phase2-extra.md'] })];
		const params = setupReach({ previousRows: rows, currentRows: rows, overviewChanged: false });

		const reach = getDecisionReach(params);

		expect(reach).toStrictEqual({ phases: [] });
	});
});
