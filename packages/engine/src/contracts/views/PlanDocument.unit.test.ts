import { describe, expect, test } from '@jest/globals';
import { PlanDocument, PlanDocumentKind } from '#src/contracts/index.ts';

const refactorWorklist = {
	at: '2026-08-04T00:00:00.000Z',
	path: '.',
	all: false,
	batches: [
		{
			id: 'batch-01:clone:src/standardsCheck',
			rule: 'clone',
			folder: 'src/standardsCheck',
			blocking: [
				{
					rule: 'clone',
					severity: 'blocking',
					siteKey: 'clone:src/standardsCheck/runStandardsCheck.ts:12',
					files: [{ path: 'src/standardsCheck/runStandardsCheck.ts', startLine: 12, endLine: 48 }],
					detail: 'a 36-line span repeated across two files',
				},
			],
			advisories: [],
		},
	],
};

const coverageWorklist = {
	at: '2026-08-04T00:00:00.000Z',
	totals: [{ scope: 'engine', statementsPct: 91.4, passed: false }],
	files: [{ path: 'packages/engine/src/views/listRuns.ts', scope: 'engine', statementsPct: 12.5 }],
};

const setupPlanDocument = ({ omit, extra = {} }: { omit?: string; extra?: Record<string, unknown> } = {}) => {
	const document: Record<string, unknown> = {
		path: 'docs/plans/web-app/phase-2.md',
		kind: 'markdown',
		text: '# Phase 2\n\nThe engine read layer.\n',
		...extra,
	};

	if (omit) {
		delete document[omit];
	}

	return { document };
};

describe('PlanDocument', () => {
	test('a markdown plan parses to its path, kind, and prose — no payload key is invented beside them', () => {
		const { document } = setupPlanDocument();

		const parsed = PlanDocument.parse(document);

		expect(parsed).toStrictEqual({
			path: 'docs/plans/web-app/phase-2.md',
			kind: 'markdown',
			text: '# Phase 2\n\nThe engine read layer.\n',
		});
	});

	test('a refactor run reads its frozen work-list back through the worklist payload, batches intact', () => {
		const { document } = setupPlanDocument({
			omit: 'text',
			extra: { path: '.lightsout/runs/run-1/worklist.json', kind: 'worklist', worklist: refactorWorklist },
		});

		const parsed = PlanDocument.parse(document);

		expect(parsed).toStrictEqual({
			path: '.lightsout/runs/run-1/worklist.json',
			kind: 'worklist',
			worklist: refactorWorklist,
		});
	});

	test("a coverage run's frozen measurement parses under its own payload key", () => {
		const { document } = setupPlanDocument({
			omit: 'text',
			extra: { path: '.lightsout/runs/run-2/worklist.json', kind: 'coverageWorklist', coverageWorklist },
		});

		const parsed = PlanDocument.parse(document);

		expect(parsed).toStrictEqual({
			path: '.lightsout/runs/run-2/worklist.json',
			kind: 'coverageWorklist',
			coverageWorklist,
		});
	});

	test('a plan deleted after its run parses as a recorded absence carrying no payload at all', () => {
		const { document } = setupPlanDocument({ omit: 'text', extra: { kind: 'missing' } });

		const parsed = PlanDocument.parse(document);

		// the drawer still has to render — an absent plan is a normal state, so the
		// path asked for survives and every payload key stays off the object
		expect(parsed).toStrictEqual({ path: 'docs/plans/web-app/phase-2.md', kind: 'missing' });
	});

	test('path and kind are each required', () => {
		for (const field of ['path', 'kind']) {
			const { document } = setupPlanDocument({ omit: field });

			const result = PlanDocument.safeParse(document);

			// without ${field} a reader cannot say which document it holds, nor what to
			// do with whatever payload sits beside it
			expect(result.success).toBe(false);
		}
	});

	test.each([
		{ kind: 'markdown', payload: { text: '# Phase 2\n' } },
		{ kind: 'worklist', payload: { worklist: refactorWorklist } },
		{ kind: 'coverageWorklist', payload: { coverageWorklist } },
		{ kind: 'missing', payload: {} },
	])('kind accepts the documented value $kind', ({ kind, payload }) => {
		const { document } = setupPlanDocument({ omit: 'text', extra: { kind, ...payload } });

		const parsed = PlanDocument.parse(document);

		expect(parsed.kind).toBe(kind);
	});

	test('kind is closed — a value outside the four documented ones is rejected rather than passed through', () => {
		for (const kind of ['md', 'json', 'Markdown', 'coverage-worklist', '', 'absent']) {
			const { document } = setupPlanDocument({ extra: { kind } });

			const result = PlanDocument.safeParse(document);

			// the app switches on this value; an unrecognised kind would fall through
			// every branch and render nothing, with no error to explain the blank
			expect(result.success).toBe(false);
		}
	});

	test('the kind vocabulary is exactly four values — a fifth would reach the app with no branch to render it', () => {
		const kinds = [...Object.values(PlanDocumentKind)].sort();

		// the drawer switches exhaustively on this list, so widening the const object
		// without widening the drawer is what this pins: every value stated here has
		// somewhere to go, and there is no fifth the schema would quietly wave through
		expect(kinds).toStrictEqual(['coverageWorklist', 'markdown', 'missing', 'worklist']);
	});

	test('kind must be one of the string members, not a truthy stand-in', () => {
		for (const kind of [0, true, null, ['markdown']]) {
			const { document } = setupPlanDocument({ extra: { kind } });

			const result = PlanDocument.safeParse(document);

			expect(result.success).toBe(false);
		}
	});

	test('path must be the string a manifest recorded, not coerced from another type', () => {
		for (const path of [42, null, ['docs/plans/web-app/phase-2.md']]) {
			const { document } = setupPlanDocument({ extra: { path } });

			const result = PlanDocument.safeParse(document);

			// the path is echoed back verbatim so a reader can link to what it asked for
			expect(result.success).toBe(false);
		}
	});

	test('text carries the file verbatim — an empty plan file is text, not an absence', () => {
		const { document } = setupPlanDocument({ extra: { text: '' } });

		const parsed = PlanDocument.parse(document);

		// an empty markdown file read successfully is a different outcome from a
		// missing one, and the falsy value has to survive the optional to say so
		expect(parsed).toStrictEqual({ path: 'docs/plans/web-app/phase-2.md', kind: 'markdown', text: '' });
	});

	test('text must be a string — a parsed object is not markdown prose', () => {
		for (const text of [{ body: '# Phase 2' }, ['# Phase 2'], 12]) {
			const { document } = setupPlanDocument({ extra: { text } });

			const result = PlanDocument.safeParse(document);

			expect(result.success).toBe(false);
		}
	});

	test('a malformed refactor work-list rejects the whole document through the nesting', () => {
		const { document } = setupPlanDocument({
			omit: 'text',
			extra: { kind: 'worklist', worklist: { ...refactorWorklist, all: 'false' } },
		});

		const result = PlanDocument.safeParse(document);

		// a half-readable work-list is refused at the boundary rather than handed on
		// as a payload whose batches every caller would then have to re-check
		expect(result.success).toBe(false);
	});

	test('a malformed coverage measurement rejects the document the same way', () => {
		const { document } = setupPlanDocument({
			omit: 'text',
			extra: { kind: 'coverageWorklist', coverageWorklist: { ...coverageWorklist, files: [{ path: 'a.ts', scope: 'engine' }] } },
		});

		const result = PlanDocument.safeParse(document);

		// validation reaches every file row — those percentages are what a chart plots
		expect(result.success).toBe(false);
	});

	test('the two work-list payloads are not interchangeable — each key validates only its own shape', () => {
		for (const extra of [
			{ kind: 'worklist', worklist: coverageWorklist },
			{ kind: 'coverageWorklist', coverageWorklist: refactorWorklist },
		]) {
			const { document } = setupPlanDocument({ omit: 'text', extra });

			const result = PlanDocument.safeParse(document);

			// both pipelines freeze a file named worklist.json; only the schema tells
			// the two apart, so neither key may accept the other's contents
			expect(result.success).toBe(false);
		}
	});

	test('the payload keys are independent optionals — each is validated alone and none is cross-checked against kind', () => {
		const { document } = setupPlanDocument({ extra: { worklist: refactorWorklist } });

		const parsed = PlanDocument.parse(document);

		// this is deliberately not a discriminated union: pairing a payload with the
		// matching kind is the reader's job, and the schema keeps whatever it is given
		expect(parsed).toStrictEqual({
			path: 'docs/plans/web-app/phase-2.md',
			kind: 'markdown',
			text: '# Phase 2\n\nThe engine read layer.\n',
			worklist: refactorWorklist,
		});
	});

	test('keys the contract does not declare are stripped, on the document and through its payload', () => {
		const { document } = setupPlanDocument({
			omit: 'text',
			extra: { kind: 'worklist', worklist: { ...refactorWorklist, runId: 'run-1' }, runId: 'run-1', bytes: 4096 },
		});

		const parsed = PlanDocument.parse(document);

		// run identity lives in the manifest, never copied onto the document a drawer
		// renders
		expect(parsed).toStrictEqual({ path: 'docs/plans/web-app/phase-2.md', kind: 'worklist', worklist: refactorWorklist });
	});
});
