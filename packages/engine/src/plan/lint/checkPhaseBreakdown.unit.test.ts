import { describe, expect, test } from '@jest/globals';
import { FindingSeverity, StructuralCheck } from '#src/contracts/index.ts';
import { checkPhaseBreakdown } from '#src/plan/lint/checkPhaseBreakdown.ts';
import { type DeclarationSpec, overviewBody } from '#tests/helpers/phasePlan.ts';

/** One `## Phases` row whose every cell reads cleanly — the shape a defect case bends one field of. */
const cleanRow: DeclarationSpec = { number: 1, file: 'phase1-core.md', created: 1, touched: 2 };

/** `count` rows, each numbered and named so nothing but the phase count can be at fault. */
const rowsFor = ({ count }: { count: number }): DeclarationSpec[] =>
	Array.from({ length: count }, (_, index) => ({ number: index + 1, file: `phase${index + 1}-step.md`, created: 1, touched: 1 }));

/** The door check as the phased draft calls it, over an overview built from `rows` or handed in verbatim. */
const setupBreakdown = ({
	rows = [cleanRow],
	overview,
	executorFileLimit = 50,
}: {
	rows?: DeclarationSpec[];
	overview?: (params: { text: string }) => string;
	executorFileLimit?: number;
} = {}) => {
	const text = overviewBody({ rows });

	return { overviewText: overview ? overview({ text }) : text, overviewBase: 'overview.md', executorFileLimit };
};

/** The same overview with every `### Phase <n> — ` block stripped: table rows whose declaration blocks were never written. */
const withoutBlocks = ({ text }: { text: string }) =>
	text.replace(/## Phase Declarations\n\n[\s\S]*?## Cross-Phase/, '## Phase Declarations\n\n## Cross-Phase');

/** The same overview carrying one extra declaration block the `## Phases` table never lists. */
const withOrphanBlock = ({ text }: { text: string }) =>
	text.replace(
		'## Cross-Phase Dependencies',
		'### Phase 9 — `phase9-ghost.md`\n\n- **Creates:** none\n- **Exports:** none\n- **Scripts:** none\n\n## Cross-Phase Dependencies',
	);

describe('checkPhaseBreakdown', () => {
	test('a breakdown whose rows, blocks and counts all read cleanly is silent', () => {
		const params = setupBreakdown();

		const findings = checkPhaseBreakdown(params);

		expect(findings).toStrictEqual([]);
	});

	test('an empty phases table blocks before anything else is inspected', () => {
		const params = setupBreakdown({ rows: [] });

		const findings = checkPhaseBreakdown(params);

		// the whole point of the door check is that nothing downstream is paid
		// for, so a breakdown declaring no phases stops here
		expect(findings).toEqual([
			{
				check: StructuralCheck.SectionsPresent,
				severity: FindingSeverity.Blocking,
				phase: 'overview.md',
				issue: expect.stringContaining('declares no phases'),
				location: 'overview.md → Phases',
				fix: expect.stringContaining('one-line scope'),
			},
		]);
	});

	test('a table row with no declaration block is blocking, naming the phase file whose block is missing', () => {
		const params = setupBreakdown({ overview: withoutBlocks });

		const findings = checkPhaseBreakdown(params);

		expect(findings.map(({ check, severity, location, issue }) => ({ check, severity, location, issue }))).toEqual([
			{
				check: StructuralCheck.SectionsPresent,
				severity: FindingSeverity.Blocking,
				location: 'overview.md → Phase Declarations',
				issue: expect.stringContaining('no block for phase1-core.md'),
			},
		]);
	});

	test('a table with no declarations section at all is the same defect as a table with an empty one', () => {
		const params = setupBreakdown({ overview: ({ text }) => text.replace(/## Phase Declarations\n\n[\s\S]*?(?=## Cross-Phase)/, '') });

		const findings = checkPhaseBreakdown(params);

		expect(findings.map(({ check, severity, issue }) => ({ check, severity, issue }))).toEqual([
			{
				check: StructuralCheck.SectionsPresent,
				severity: FindingSeverity.Blocking,
				issue: expect.stringContaining('no block for phase1-core.md'),
			},
		]);
	});

	test('a declaration block the table never lists is reported as an orphan, and its unreadable counts with it', () => {
		const params = setupBreakdown({ overview: withOrphanBlock });

		const findings = checkPhaseBreakdown(params);

		// the orphan parses with no counts at all, so the two cell findings are
		// the same defect seen from the size rule — all three are blocking
		expect(findings.map(({ check, severity, issue }) => ({ check, severity, issue }))).toEqual([
			{
				check: StructuralCheck.DeclarationConsistent,
				severity: FindingSeverity.Blocking,
				issue: expect.stringContaining("has a block for 'phase9-ghost.md'"),
			},
			{
				check: StructuralCheck.DeclarationConsistent,
				severity: FindingSeverity.Blocking,
				issue: expect.stringContaining("the 'Creates' count for phase9-ghost.md is missing"),
			},
			{
				check: StructuralCheck.DeclarationConsistent,
				severity: FindingSeverity.Blocking,
				issue: expect.stringContaining("the 'Touches' count for phase9-ghost.md is missing"),
			},
		]);
	});

	test('phase numbers that skip a value are blocking, stating the run they should have made', () => {
		const params = setupBreakdown({
			rows: [
				{ number: 1, file: 'phase1-core.md', created: 1, touched: 1 },
				{ number: 3, file: 'phase3-tail.md', created: 1, touched: 1 },
			],
		});

		const findings = checkPhaseBreakdown(params);

		expect(findings.map(({ check, severity, issue }) => ({ check, severity, issue }))).toEqual([
			{ check: StructuralCheck.DeclarationConsistent, severity: FindingSeverity.Blocking, issue: expect.stringContaining('1, 3 rather than 1 to 2') },
		]);
	});

	test('a duplicated phase number is blocking — the run is 1..n without repeats, not merely ascending', () => {
		const params = setupBreakdown({
			rows: [
				{ number: 1, file: 'phase1-core.md', created: 1, touched: 1 },
				{ number: 1, file: 'phase1-again.md', created: 1, touched: 1 },
			],
		});

		const findings = checkPhaseBreakdown(params);

		expect(findings.map(({ check, issue }) => ({ check, issue }))).toEqual([
			{ check: StructuralCheck.DeclarationConsistent, issue: expect.stringContaining('1, 1 rather than 1 to 2') },
		]);
	});

	test('a filename that disagrees with its row number is blocking', () => {
		const params = setupBreakdown({ rows: [{ number: 1, file: 'core.md', created: 1, touched: 1 }] });

		const findings = checkPhaseBreakdown(params);

		expect(findings.map(({ check, severity, location, issue }) => ({ check, severity, location, issue }))).toEqual([
			{
				check: StructuralCheck.DeclarationConsistent,
				severity: FindingSeverity.Blocking,
				location: 'overview.md → Phases → core.md',
				issue: expect.stringContaining('does not read phase1-<slug>.md'),
			},
		]);
	});

	test.each([
		{ label: 'Creates', cell: '| 1 | `phase1-core.md` | the work |  | 2 |', why: 'an empty cell' },
		{ label: 'Touches', cell: '| 1 | `phase1-core.md` | the work | 1 | ~40 |', why: 'a non-integer cell' },
	])('$why for $label stops the run rather than waving the phase through', ({ label, cell }) => {
		const params = setupBreakdown({ overview: ({ text }) => text.replace('| 1 | `phase1-core.md` | the work | 1 | 2 |', cell) });

		const findings = checkPhaseBreakdown(params);

		// this is the only created-file check that runs before a phase file
		// exists, so an unreadable count cannot be treated as "no problem"
		expect(findings.map(({ check, severity, issue }) => ({ check, severity, issue }))).toEqual([
			{
				check: StructuralCheck.DeclarationConsistent,
				severity: FindingSeverity.Blocking,
				issue: expect.stringContaining(`the '${label}' count for phase1-core.md is missing or not an integer`),
			},
		]);
	});

	test('a phase declaring more created files than the ceiling is blocking, and the fix is to split it', () => {
		const params = setupBreakdown({ rows: [{ number: 1, file: 'phase1-core.md', created: 31, touched: 31 }] });

		const findings = checkPhaseBreakdown(params);

		expect(findings.map(({ check, severity, location, issue, fix }) => ({ check, severity, location, issue, fix }))).toEqual([
			{
				check: StructuralCheck.CreatedFilesWithinCeiling,
				severity: FindingSeverity.Blocking,
				location: 'overview.md → Phases → phase1-core.md',
				// 30 is the fixed ceiling: nothing a plan declares raises it
				issue: expect.stringContaining('create 31 source files, over the 30-file ceiling'),
				fix: expect.stringContaining('split this phase into two'),
			},
		]);
	});

	test('a phase declaring exactly the ceiling is silent — the ceiling is the last legal count', () => {
		const params = setupBreakdown({ rows: [{ number: 1, file: 'phase1-core.md', created: 30, touched: 30 }] });

		const findings = checkPhaseBreakdown(params);

		expect(findings).toStrictEqual([]);
	});

	test('a phase declaring more touched files than the configured limit is advisory, naming that limit as the source', () => {
		const params = setupBreakdown({ rows: [{ number: 1, file: 'phase1-core.md', created: 1, touched: 51 }], executorFileLimit: 50 });

		const findings = checkPhaseBreakdown(params);

		// touching many files is legal work — refusing it would park every
		// mechanical rename phase
		expect(findings.map(({ check, severity, issue }) => ({ check, severity, issue }))).toEqual([
			{
				check: StructuralCheck.ScopeWithinGuardrail,
				severity: FindingSeverity.Advisory,
				issue: expect.stringContaining('touch 51 source files, over the 50-file limit from the configured executor-file-limit'),
			},
		]);
	});

	test('a phase over its own declared budget names that budget rather than the configured limit', () => {
		const params = setupBreakdown({ rows: [{ number: 1, file: 'phase1-core.md', created: 1, touched: 21, fileBudget: 20 }], executorFileLimit: 50 });

		const findings = checkPhaseBreakdown(params);

		expect(findings.map(({ check, severity, issue }) => ({ check, severity, issue }))).toEqual([
			{
				check: StructuralCheck.ScopeWithinGuardrail,
				severity: FindingSeverity.Advisory,
				issue: expect.stringContaining("over the 20-file limit from phase1-core.md's own declared file budget"),
			},
		]);
	});

	test('a declared budget covering the declared touched count silences the note, however far over the configured limit', () => {
		const params = setupBreakdown({ rows: [{ number: 1, file: 'phase1-core.md', created: 1, touched: 120, fileBudget: 200 }], executorFileLimit: 50 });

		const findings = checkPhaseBreakdown(params);

		// declaring a budget is how a deliberately mechanical phase says so
		expect(findings).toStrictEqual([]);
	});

	test('a ninth phase raises the phase-count advisory alongside the size rules', () => {
		const params = setupBreakdown({ rows: rowsFor({ count: 9 }) });

		const findings = checkPhaseBreakdown(params);

		expect(findings.map(({ check, severity, phase }) => ({ check, severity, phase }))).toStrictEqual([
			{ check: StructuralCheck.PhaseCount, severity: FindingSeverity.Advisory, phase: 'overview.md' },
		]);
	});

	test('eight phases sit on the soft threshold rather than over it', () => {
		const params = setupBreakdown({ rows: rowsFor({ count: 8 }) });

		const findings = checkPhaseBreakdown(params);

		expect(findings).toStrictEqual([]);
	});

	test('every finding is labelled with the overview it was read from, whatever that file is called', () => {
		const params = { ...setupBreakdown({ rows: [{ number: 2, file: 'phase2-core.md', created: 1, touched: 1 }] }), overviewBase: 'plan-overview.md' };

		const findings = checkPhaseBreakdown(params);

		// the label is what the CLI prints as "which file is this finding in"
		expect(findings.map(({ phase, location }) => ({ phase, location }))).toEqual([{ phase: 'plan-overview.md', location: 'plan-overview.md → Phases' }]);
	});
});
