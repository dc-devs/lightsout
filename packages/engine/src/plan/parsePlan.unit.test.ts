import { describe, expect, test } from '@jest/globals';
import { parsePlan } from '#src/plan/parsePlan.ts';

const parse = ({ content, base = 'demo.md' }: { content: string; base?: string }) => parsePlan({ content, base });

describe('parsePlan', () => {
	test('reads the title from the first level-one heading', () => {
		expect(parse({ content: '# Add search\n\nbody\n' }).title).toBe('Add search');
	});

	test('a plan with no heading has an empty title rather than an invented one', () => {
		// the structural lint reports the missing heading; the parser does not
		// guess a title from the filename to paper over it
		expect(parse({ content: 'just some prose\n' }).title).toBe('');
	});

	test('splits the body into its level-two sections, keeping subheadings inside them', () => {
		const plan = parse({ content: '# Plan\n\n## Files to Modify\n\n### `src/a.ts`\n\n## Verification\n\n- `pnpm check`\n' });

		expect([...plan.sections.keys()]).toStrictEqual(['Files to Modify', 'Verification']);
		expect(plan.sections.get('Files to Modify')).toContain('### `src/a.ts`');
	});

	test('collects the modify paths from the subheadings that name them', () => {
		const plan = parse({ content: '# Plan\n\n## Files to Modify\n\n### `src/a.ts`\n\nwhy\n\n### `src/b.ts`\n' });

		expect(plan.modifyPaths).toStrictEqual(['src/a.ts', 'src/b.ts']);
	});

	test('collects the mirror paths from bullets, which is how that section is written', () => {
		const plan = parse({ content: '# Plan\n\n## Patterns to Mirror\n\n- `src/existing.ts` — follow this\n' });

		expect(plan.mirrorPaths).toStrictEqual(['src/existing.ts']);
	});

	test('a file named overview.md is an overview whatever its body says', () => {
		expect(parse({ content: '# Anything\n', base: 'overview.md' }).variant).toBe('overview');
	});

	test('a plan carrying both phase sections is an overview, wherever it lives', () => {
		const content = '# Plan\n\n## Phases\n\n- one\n\n## Cross-Phase Dependencies\n\n- none\n';

		expect(parse({ content }).variant).toBe('overview');
	});

	test('a title ending in Overview marks the variant too', () => {
		expect(parse({ content: '# Demo — Overview\n' }).variant).toBe('overview');
	});

	test('anything else is implementable, which is the variant that gets built', () => {
		expect(parse({ content: '# Add search\n\n## Files to Modify\n' }).variant).toBe('implementable');
	});

	test('sections before the first heading are not attributed to a section', () => {
		const plan = parse({ content: 'stray line\n\n## Verification\n\n- `pnpm check`\n' });

		expect([...plan.sections.keys()]).toStrictEqual(['Verification']);
	});

	test('a modify subheading with no code span contributes no path', () => {
		const plan = parse({ content: '# Plan\n\n## Files to Modify\n\n### General cleanup\n\n### `src/a.ts`\n' });

		// a prose subheading names no file; guessing one would send an agent at nothing
		expect(plan.modifyPaths).toStrictEqual(['src/a.ts']);
	});

	test('a verification bullet with no code span contributes no command', () => {
		const plan = parse({ content: '# Plan\n\n## Verification\n\n- run the tests somehow\n- `pnpm check`\n' });

		expect(plan.verificationCommands).toStrictEqual(['pnpm check']);
	});

	test('a `###` code span in a later section is not a Files-to-Create path', () => {
		const plan = parse({ content: '# Plan\n\n## Files to Create\n\n### `src/new.ts`\n\n## Notes\n\n### `src/index.js`\n\nBackground reading.\n' });

		// the create-path scan closes at the next `##` heading
		expect(plan.createPaths).toStrictEqual(['src/new.ts']);
	});

	test('a create heading whose first code span is not a path falls through to the path span', () => {
		const plan = parse({ content: '# Plan\n\n## Files to Create\n\n### `oneConst` in `src/index.js`\n' });

		// the path-shaped span is the create path
		expect(plan.createPaths).toStrictEqual(['src/index.js']);
	});

	test('a create heading with no path-shaped code span contributes no create path', () => {
		const plan = parse({ content: '# Plan\n\n## Files to Create\n\n### `newThing`\n' });

		// a bare symbol name is not a path and is never stat-ed
		expect(plan.createPaths).toStrictEqual([]);
	});

	test('the earlier-phase modify section is its own path list, not part of Files to Modify', () => {
		const content =
			'# Plan\n\n## Files to Modify\n\n### `src/here.ts`\n\n## Files to Modify from Earlier Phases\n\n### `src/from-phase-one.ts`\n\nExtend it.\n';
		const plan = parse({ content });

		// the two headings mean opposite things about disk — one path must exist,
		// the other must not — so they can never share a list
		expect(plan.modifyPaths).toStrictEqual(['src/here.ts']);
		expect(plan.earlierPhaseModifyPaths).toStrictEqual(['src/from-phase-one.ts']);
	});

	test('collects the delete paths from the subheadings that name them', () => {
		const plan = parse({ content: '# Plan\n\n## Files to Delete\n\n### `src/gone.ts`\n\nno longer called\n' });

		expect(plan.deletePaths).toStrictEqual(['src/gone.ts']);
	});

	test('a move heading yields its source and destination in written order', () => {
		const plan = parse({ content: '# Plan\n\n## Files to Move\n\n### `src/old/thing.ts` → `src/new/thing.ts`\n\nrelocated\n' });

		expect(plan.movePaths).toStrictEqual([{ from: 'src/old/thing.ts', to: 'src/new/thing.ts' }]);
		expect(plan.malformedMoveLines).toStrictEqual([]);
	});

	test('a move heading naming one path is recorded by line number rather than parsed as a one-path move', () => {
		const plan = parse({ content: '# Plan\n\n## Files to Move\n\n### `src/old/thing.ts`\n\nto where?\n' });

		// guessing a destination would silently lose a file the plan meant to move;
		// the line number is what the lint points the writer at
		expect(plan.movePaths).toStrictEqual([]);
		expect(plan.malformedMoveLines).toStrictEqual([5]);
	});

	test('a `###` heading in the section after Files to Move is neither a move nor a malformed one', () => {
		const content = '# Plan\n\n## Files to Move\n\n### `src/a.ts` → `src/b.ts`\n\nmoved\n\n## Files to Modify\n\n### `src/c.ts`\n\nchanged\n';
		const plan = parse({ content });

		// the move scan closes at the next `##`, so an ordinary modify subheading is
		// never reported as a half-written move
		expect({ movePaths: plan.movePaths, malformedMoveLines: plan.malformedMoveLines }).toStrictEqual({
			movePaths: [{ from: 'src/a.ts', to: 'src/b.ts' }],
			malformedMoveLines: [],
		});
	});

	test('the file budget is the first integer in its section, and absent when the section is', () => {
		expect(parse({ content: '# Plan\n\n## File Budget\n\n120\n' }).fileBudget).toBe(120);
		// a plan declaring nothing takes the configured default
		expect(parse({ content: '# Plan\n\n## Files to Modify\n' }).fileBudget).toBeUndefined();
		// a section with prose and no number declares nothing either
		expect(parse({ content: '# Plan\n\n## File Budget\n\nas many as it takes\n' }).fileBudget).toBeUndefined();
	});

	test('reads the acceptance-test ledger, numbering every row by its line in the plan file', () => {
		const content =
			'# Plan\n\n## Acceptance Tests\n\n| Criterion | Test file | Test name | Gate |\n|---|---|---|---|\n| it parses | `src/a.unit.test.ts` | it parses | check |\n';
		const plan = parse({ content });

		expect(plan.ledger).toStrictEqual([{ criterion: 'it parses', testFile: 'src/a.unit.test.ts', testName: 'it parses', gate: 'check', line: 7 }]);
		expect(plan.malformedLedgerLines).toStrictEqual([]);
	});

	test('a ledger row the parser cannot read is kept as a line number rather than lost', () => {
		const content =
			'# Plan\n\n## Acceptance Tests\n\n| Criterion | Test file | Test name | Gate |\n|---|---|---|---|\n| it parses | nowhere | it parses | check |\n';
		const plan = parse({ content });

		expect({ ledger: plan.ledger, malformedLedgerLines: plan.malformedLedgerLines }).toStrictEqual({ ledger: [], malformedLedgerLines: [7] });
	});

	test('reads the prose-files list, and keeps a bullet with no reason as a line number', () => {
		const content = '# Plan\n\n## Prose Files\n\n- `docs/a.md` — a document states no behaviour\n- `docs/b.md`\n';
		const plan = parse({ content });

		expect(plan.proseFiles).toStrictEqual([{ path: 'docs/a.md', reason: 'a document states no behaviour', line: 5 }]);
		expect(plan.malformedProseLines).toStrictEqual([6]);
	});

	test('a plan carrying neither section has both empty, which is every plan written before the ledger existed', () => {
		const plan = parse({ content: '# Plan\n\n## Files to Modify\n\n### `src/a.ts`\n' });

		expect({ ledger: plan.ledger, proseFiles: plan.proseFiles }).toStrictEqual({ ledger: [], proseFiles: [] });
	});

	test('records the Decision Log range from its heading line to the line before the next section', () => {
		const content = '# Plan\n\n## Decision Log\n\n| # | Source |\n|---|--------|\n| 1 | Brainstorm |\n\n## Global Constraints\n\n- none\n';
		const plan = parse({ content });

		// the heading sits on line 3 and the next `##` on line 9, so the range runs
		// through the blank line 8 — the span the rewriter replaces whole
		expect(plan.decisionLogRange).toStrictEqual({ start: 3, end: 8 });
	});

	test('leaves the Decision Log range unset when the file carries no such section', () => {
		const plan = parse({ content: '# Plan\n\n## Global Constraints\n\n- none\n' });

		// a zero-length span would read as an empty section to replace; absent is
		// what tells the rewriter to insert one instead
		expect(plan.decisionLogRange).toBeUndefined();
	});

	test('records a 1-based inclusive line range for every section, matching the decision log range', () => {
		const content =
			'# Plan\n\n## Context\n\nWhy this plan exists.\n\n## Decision Log\n\n| # | Source |\n|---|--------|\n| 1 | Brainstorm |\n\n## Verification\n\n- `pnpm check`\n';
		const plan = parse({ content });

		// every section spans its own heading line through the last line before the
		// next `##`, the blank line between them included — the same span the
		// Decision Log's own range already states, so the two can never disagree
		expect({ ranges: [...plan.sectionRanges], decisionLogRange: plan.decisionLogRange }).toStrictEqual({
			ranges: [
				['Context', { start: 3, end: 6 }],
				['Decision Log', { start: 7, end: 12 }],
				['Verification', { start: 13, end: 16 }],
			],
			decisionLogRange: { start: 7, end: 12 },
		});
	});

	test('parsePlan: generatedRegionRanges holds exactly the engine-composed sections the file carries, and no authored one', () => {
		const content =
			'# Plan\n\n## Context\n\nWhy this plan exists.\n\n## Decision Log\n\n| # | Source |\n\n## Global Constraints\n\n- none\n\n## Phases\n\n| # | File |\n\n## Phase Declarations\n\n### Phase 1 — `phase1.md`\n\n## Cross-Phase Dependencies\n\n- none\n';
		const plan = parse({ content });

		// only the sections the engine composes from a record are in the map, each
		// spanning its heading line through the last line before the next `##`;
		// Context and Cross-Phase Dependencies are authored prose and stay out
		expect(Object.fromEntries(plan.generatedRegionRanges)).toStrictEqual({
			'Decision Log': { start: 7, end: 10 },
			'Global Constraints': { start: 11, end: 14 },
			Phases: { start: 15, end: 18 },
			'Phase Declarations': { start: 19, end: 22 },
		});
	});

	test('parsePlan: a plan carrying no engine-composed section has an empty generatedRegionRanges and no decisionLogRange', () => {
		const plan = parse({ content: '# Plan\n\n## Context\n\nWhy this plan exists.\n\n## Verification\n\n- `pnpm check`\n' });

		// a region the file does not carry gets no entry at all — an invented empty
		// span would read as a section to replace rather than one to insert
		expect({ ranges: [...plan.generatedRegionRanges], decisionLogRange: plan.decisionLogRange }).toStrictEqual({
			ranges: [],
			decisionLogRange: undefined,
		});
	});

	test('parsePlan: decisionLogRange is the generatedRegionRanges entry for the Decision Log, not a second scan', () => {
		const plan = parse({ content: '# Plan\n\n## Decision Log\n\n| # | Source |\n\n## Global Constraints\n\n- none\n' });

		const entry = plan.generatedRegionRanges.get('Decision Log');

		// the named field is a read of the map, so the two can never disagree
		expect(plan.decisionLogRange).toStrictEqual({ start: 3, end: 6 });
		expect(plan.decisionLogRange).toBe(entry);
	});
});
