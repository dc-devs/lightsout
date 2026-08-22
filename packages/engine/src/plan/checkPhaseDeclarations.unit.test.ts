import { describe, expect, test } from '@jest/globals';
import { FindingSeverity, StructuralCheck } from '#src/contracts/index.ts';
import { checkPhaseDeclarations, type PhaseDeclaration, type PhaseFile } from '#src/plan/index.ts';
import { type PhaseSpec, phaseBody, phaseFile } from '#tests/helpers/phasePlan.ts';

/** One overview row, defaulted to the shape that agrees with a phase file declaring nothing. */
const declarationFor = (overrides: Partial<PhaseDeclaration> & { file: string }): PhaseDeclaration => ({
	number: 1,
	scope: 'the work',
	createdCount: 0,
	touchedCount: 0,
	creates: [],
	exports: [],
	scripts: [],
	...overrides,
});

/** The phase files the declarations are held against, parsed as the lint parses them. */
const phaseFilesFor = ({ specs }: { specs: { base: string; spec?: PhaseSpec }[] }): PhaseFile[] =>
	specs.map(({ base, spec }) => phaseFile({ base, body: phaseBody(spec) }));

/** The check as the lint calls it: the overview is always `overview.md`, and counts default to none recorded. */
const check = ({
	declarations,
	phases,
	counts = new Map<string, { created: number; touched: number }>(),
}: {
	declarations: PhaseDeclaration[];
	phases: PhaseFile[];
	counts?: Map<string, { created: number; touched: number }>;
}) => checkPhaseDeclarations({ declarations, phases, overviewBase: 'overview.md', counts });

describe('checkPhaseDeclarations', () => {
	test('a declaration that agrees with its phase file in every respect is silent', () => {
		const phases = phaseFilesFor({ specs: [{ base: 'phase1-core.md', spec: { create: ['src/core.ts'] } }] });
		const declarations = [declarationFor({ file: 'phase1-core.md', createdCount: 1, touchedCount: 1, creates: ['src/core.ts'], exports: ['core'] })];

		const findings = check({ declarations, phases, counts: new Map([['phase1-core.md', { created: 1, touched: 1 }]]) });

		// the export is named by the file the phase creates, which is what
		// one-export-per-file makes it, got: ${JSON.stringify(findings)}
		expect(findings).toStrictEqual([]);
	});

	test('a declared file that is not one of the plan phase files is reported on the overview', () => {
		const phases = phaseFilesFor({ specs: [{ base: 'phase1-core.md' }] });
		const declarations = [declarationFor({ file: 'phase1-core.md' }), declarationFor({ number: 2, file: 'phase2-ghost.md' })];

		const findings = check({ declarations, phases, counts: new Map([['phase1-core.md', { created: 0, touched: 0 }]]) });

		expect(findings).toStrictEqual([
			{
				check: StructuralCheck.DeclarationConsistent,
				severity: FindingSeverity.Blocking,
				phase: 'overview.md',
				issue: "the phase breakdown declares 'phase2-ghost.md', which is not one of this plan's phase files",
				location: 'overview.md → phase2-ghost.md',
				fix: 'correct the filename, or drop the row and its declaration block',
			},
		]);
	});

	test('a phase file with no row is reported against the phase, not the overview', () => {
		const phases = phaseFilesFor({ specs: [{ base: 'phase1-core.md' }, { base: 'phase2-extra.md' }] });
		const declarations = [declarationFor({ file: 'phase1-core.md' })];

		const findings = check({ declarations, phases, counts: new Map([['phase1-core.md', { created: 0, touched: 0 }]]) });

		// the file that has to change is the phase's, so that is what the finding
		// names
		expect(findings.map(({ phase, issue, fix }) => ({ phase, issue, fix }))).toStrictEqual([
			{
				phase: 'phase2-extra.md',
				issue: "this phase file has no row in the overview's phase breakdown",
				fix: "add a '## Phases' row and a '## Phase Declarations' block for phase2-extra.md",
			},
		]);
	});

	test('a declaration block the table never lists is reported as an orphan', () => {
		const phases = phaseFilesFor({ specs: [{ base: 'phase1-core.md' }] });
		const declarations = [declarationFor({ file: 'phase1-core.md' }), declarationFor({ number: 0, file: 'phase2-ghost.md', scope: '' })];

		const findings = check({ declarations, phases, counts: new Map([['phase1-core.md', { created: 0, touched: 0 }]]) });

		expect(findings.map((finding) => finding.issue)).toStrictEqual([
			"the phase breakdown declares 'phase2-ghost.md', which is not one of this plan's phase files",
			"'## Phase Declarations' has a block for 'phase2-ghost.md', which the '## Phases' table does not list",
		]);
	});

	test('phase numbers that skip are reported with the sequence they actually read', () => {
		const phases = phaseFilesFor({ specs: [{ base: 'phase1-core.md' }, { base: 'phase3-extra.md' }] });
		const declarations = [declarationFor({ number: 1, file: 'phase1-core.md' }), declarationFor({ number: 3, file: 'phase3-extra.md' })];
		const counts = new Map([
			['phase1-core.md', { created: 0, touched: 0 }],
			['phase3-extra.md', { created: 0, touched: 0 }],
		]);

		const findings = check({ declarations, phases, counts });

		expect(findings.map((finding) => finding.issue)).toStrictEqual(['the phase numbers are 1, 3 rather than 1 to 2 with no gaps or duplicates']);
	});

	test('a filename whose number disagrees with its row is reported', () => {
		const phases = phaseFilesFor({ specs: [{ base: 'phase1-core.md' }, { base: 'phase9-extra.md' }] });
		const declarations = [declarationFor({ number: 1, file: 'phase1-core.md' }), declarationFor({ number: 2, file: 'phase9-extra.md' })];
		const counts = new Map([
			['phase1-core.md', { created: 0, touched: 0 }],
			['phase9-extra.md', { created: 0, touched: 0 }],
		]);

		const findings = check({ declarations, phases, counts });

		expect(findings.map((finding) => finding.issue)).toStrictEqual(["phase 2 is declared in 'phase9-extra.md', whose name does not read phase2-<slug>.md"]);
	});

	test('a count cell the parser could not read is reported as missing rather than assumed', () => {
		const phases = phaseFilesFor({ specs: [{ base: 'phase1-core.md' }] });
		const declarations = [declarationFor({ file: 'phase1-core.md', createdCount: undefined })];

		const findings = check({ declarations, phases, counts: new Map([['phase1-core.md', { created: 0, touched: 0 }]]) });

		expect(findings.map((finding) => finding.issue)).toStrictEqual(["the 'creates' count for phase1-core.md is missing or not an integer"]);
	});

	test('a declared count that disagrees with the phase file is reported with both numbers', () => {
		const phases = phaseFilesFor({ specs: [{ base: 'phase1-core.md', spec: { create: ['src/core.ts'] } }] });
		const declarations = [declarationFor({ file: 'phase1-core.md', createdCount: 2, touchedCount: 1 })];

		const findings = check({ declarations, phases, counts: new Map([['phase1-core.md', { created: 1, touched: 1 }]]) });

		// equality, not "at least": an overstated count is drift too, and the door
		// check reshapes a breakdown from these numbers
		expect(findings.map((finding) => finding.issue)).toStrictEqual(['phase1-core.md is declared to creates 2 source files, but its own file lists 1']);
	});

	test('a phase the counts map never recorded is not reported as a mismatch', () => {
		const phases = phaseFilesFor({ specs: [{ base: 'phase1-core.md' }] });
		const declarations = [declarationFor({ file: 'phase1-core.md' })];

		const findings = check({ declarations, phases });

		// with no real number to compare against, silence is the only honest answer
		expect(findings).toStrictEqual([]);
	});

	test('a declared creates path the phase file lists nowhere is reported', () => {
		const phases = phaseFilesFor({ specs: [{ base: 'phase1-core.md' }] });
		const declarations = [declarationFor({ file: 'phase1-core.md', creates: ['src/absent.ts'] })];

		const findings = check({ declarations, phases, counts: new Map([['phase1-core.md', { created: 0, touched: 0 }]]) });

		expect(findings.map((finding) => finding.issue)).toStrictEqual([
			"phase1-core.md is declared to create 'src/absent.ts', which it lists under neither Files to Create nor Files to Move",
		]);
	});

	test('a move destination is a path the phase writes, so declaring it is honest', () => {
		const phases = phaseFilesFor({ specs: [{ base: 'phase1-core.md', spec: { move: [{ from: 'src/old.ts', to: 'src/dest.ts' }] } }] });
		const declarations = [declarationFor({ file: 'phase1-core.md', touchedCount: 2, creates: ['src/dest.ts'] })];

		const findings = check({ declarations, phases, counts: new Map([['phase1-core.md', { created: 0, touched: 2 }]]) });

		expect(findings).toStrictEqual([]);
	});

	test('a declared export that appears nowhere in the phase file is reported', () => {
		const phases = phaseFilesFor({ specs: [{ base: 'phase1-core.md' }] });
		const declarations = [declarationFor({ file: 'phase1-core.md', exports: ['buildCore'] })];

		const findings = check({ declarations, phases, counts: new Map([['phase1-core.md', { created: 0, touched: 0 }]]) });

		expect(findings.map((finding) => finding.issue)).toStrictEqual([
			"phase1-core.md is declared to export 'buildCore', which appears nowhere in that phase file",
		]);
	});

	test('an export named in a backtick span of the phase file counts as appearing', () => {
		const phases = phaseFilesFor({ specs: [{ base: 'phase1-core.md', spec: { note: 'The phase defines `buildCore`.' } }] });
		const declarations = [declarationFor({ file: 'phase1-core.md', exports: ['buildCore'] })];

		const findings = check({ declarations, phases, counts: new Map([['phase1-core.md', { created: 0, touched: 0 }]]) });

		expect(findings).toStrictEqual([]);
	});

	test('a declared script the phase file never names is reported', () => {
		const phases = phaseFilesFor({ specs: [{ base: 'phase1-core.md' }] });
		const declarations = [declarationFor({ file: 'phase1-core.md', scripts: ['check:core'] })];

		const findings = check({ declarations, phases, counts: new Map([['phase1-core.md', { created: 0, touched: 0 }]]) });

		expect(findings.map((finding) => finding.issue)).toStrictEqual([
			"phase1-core.md is declared to add the script 'check:core', which appears nowhere in that phase file",
		]);
	});

	test('a declared script the phase file names in a code span is honest', () => {
		const phases = phaseFilesFor({ specs: [{ base: 'phase1-core.md', spec: { commands: ['true', 'check:core'] } }] });
		const declarations = [declarationFor({ file: 'phase1-core.md', scripts: ['check:core'] })];

		const findings = check({ declarations, phases, counts: new Map([['phase1-core.md', { created: 0, touched: 0 }]]) });

		expect(findings).toStrictEqual([]);
	});

	test('the two copies of a file budget must agree', () => {
		const phases = phaseFilesFor({ specs: [{ base: 'phase1-core.md', spec: { fileBudget: 8 } }] });
		const declarations = [declarationFor({ file: 'phase1-core.md', fileBudget: 12 })];

		const findings = check({ declarations, phases, counts: new Map([['phase1-core.md', { created: 0, touched: 0 }]]) });

		// the door check reads the overview's copy, the implementing agent is
		// handed the phase file's
		expect(findings.map((finding) => finding.issue)).toStrictEqual(["the file budget declared for phase1-core.md (12) is not its own '## File Budget' (8)"]);
	});

	test('a file budget below the phase own declared touched count is reported', () => {
		const created = ['src/a.ts', 'src/b.ts', 'src/c.ts', 'src/d.ts', 'src/e.ts'];
		const phases = phaseFilesFor({ specs: [{ base: 'phase1-core.md', spec: { create: created, fileBudget: 3 } }] });
		const declarations = [declarationFor({ file: 'phase1-core.md', createdCount: 5, touchedCount: 5, fileBudget: 3 })];

		const findings = check({ declarations, phases, counts: new Map([['phase1-core.md', { created: 5, touched: 5 }]]) });

		// a budget under the phase own work would refuse it at implement time
		expect(findings.map((finding) => finding.issue)).toStrictEqual(['the file budget declared for phase1-core.md (3) is below its own touched count (5)']);
	});
});
