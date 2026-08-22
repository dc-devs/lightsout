import { describe, expect, test } from '@jest/globals';
import { parsePhaseDeclarations, parsePlan } from '#src/plan/index.ts';

/** An overview carrying the given `## Phases` table rows and `## Phase Declarations` blocks, parsed as the lint parses it. */
const setupOverview = ({ rows = '', declarations = '' }: { rows?: string; declarations?: string } = {}) => {
	const content = `# Demo — Overview

## Phases

| # | File | Scope | Creates | Touches |
|---|------|-------|---------|---------|
${rows}

## Phase Declarations

${declarations}

## Cross-Phase Dependencies

- None.
`;

	return { plan: parsePlan({ content, base: 'overview.md' }) };
};

/** An overview with neither declaration surface — the shape a hand-edit that deleted both leaves behind. */
const setupBareOverview = () => ({
	plan: parsePlan({ content: '# Demo — Overview\n\n## Global Constraints\n\n- None\n', base: 'overview.md' }),
});

describe('parsePhaseDeclarations', () => {
	test('a table row and the block naming the same file become one declaration', () => {
		const { plan } = setupOverview({
			rows: '| 1 | `phase1-core.md` | the core | 3 | 7 |',
			declarations: `### Phase 1 — \`phase1-core.md\`

- **Creates:** \`packages/engine/src/core.ts\`
- **Exports:** \`buildCore\`, \`CoreOptions\`
- **Scripts:** \`check:core\`
- **File budget:** 12`,
		});

		const declarations = parsePhaseDeclarations({ plan });

		expect(declarations).toStrictEqual([
			{
				number: 1,
				file: 'phase1-core.md',
				scope: 'the core',
				createdCount: 3,
				touchedCount: 7,
				creates: ['packages/engine/src/core.ts'],
				exports: ['buildCore', 'CoreOptions'],
				scripts: ['check:core'],
				fileBudget: 12,
			},
		]);
	});

	test('the sentinel the template defines for an empty bullet declares nothing rather than a name', () => {
		const { plan } = setupOverview({
			rows: '| 1 | `phase1-core.md` | the core | 0 | 0 |',
			declarations: `### Phase 1 — \`phase1-core.md\`

- **Creates:** none
- **Exports:** None
- **Scripts:** none`,
		});

		const declarations = parsePhaseDeclarations({ plan });

		expect(declarations[0]).toEqual(expect.objectContaining({ creates: [], exports: [], scripts: [], fileBudget: undefined }));
	});

	test('a count cell that is empty or not an integer is preserved as undefined rather than repaired', () => {
		const { plan } = setupOverview({ rows: '| 2 | `phase2-extra.md` | the extra |  | soon |' });

		const declarations = parsePhaseDeclarations({ plan });

		// the consistency check is what reports a missing count — a parser that
		// guessed zero would hand it a number nobody wrote
		expect(declarations[0]).toEqual(expect.objectContaining({ number: 2, file: 'phase2-extra.md', createdCount: undefined, touchedCount: undefined }));
	});

	test('a row with no declaration block hands nothing forward, which is legitimate', () => {
		const { plan } = setupOverview({ rows: '| 1 | `phase1-core.md` | the core | 2 | 4 |' });

		const declarations = parsePhaseDeclarations({ plan });

		expect(declarations).toStrictEqual([
			{ number: 1, file: 'phase1-core.md', scope: 'the core', createdCount: 2, touchedCount: 4, creates: [], exports: [], scripts: [], fileBudget: undefined },
		]);
	});

	test('a block the table does not list is returned as an orphan the consistency check can report', () => {
		const { plan } = setupOverview({
			rows: '| 1 | `phase1-core.md` | the core | 0 | 0 |',
			declarations: `### Phase 1 — \`phase1-core.md\`

- **Creates:** none
- **Exports:** none
- **Scripts:** none

### Phase 2 — \`phase2-ghost.md\`

- **Creates:** \`src/ghost.ts\`
- **Exports:** none
- **Scripts:** none`,
		});

		const declarations = parsePhaseDeclarations({ plan });

		// number 0 is the marker for "matched no row" — dropping the block would
		// hide the hand-edit that orphaned it
		expect(declarations[1]).toStrictEqual({
			number: 0,
			file: 'phase2-ghost.md',
			scope: '',
			creates: ['src/ghost.ts'],
			exports: [],
			scripts: [],
			fileBudget: undefined,
		});
	});

	test('a block joins to its row by filename, not by the number its header prints', () => {
		const { plan } = setupOverview({
			rows: '| 1 | `phase1-core.md` | the core | 0 | 0 |',
			declarations: `### Phase 4 — \`phase1-core.md\`

- **Creates:** \`src/core.ts\`
- **Exports:** none
- **Scripts:** none`,
		});

		const declarations = parsePhaseDeclarations({ plan });

		// a Converge edit renumbers a phase far more readily than it renames the
		// file, and joining on the number would pair this block with phase 4
		expect(declarations).toEqual([expect.objectContaining({ number: 1, file: 'phase1-core.md', creates: ['src/core.ts'] })]);
	});

	test('the header and separator rows drop out, and the rest keep table order', () => {
		const { plan } = setupOverview({
			rows: `| 2 | \`phase2-extra.md\` | the extra | 0 | 0 |
| 1 | \`phase1-core.md\` | the core | 0 | 0 |`,
		});

		const declarations = parsePhaseDeclarations({ plan });

		// requiring an integer first cell is what skips the two header lines, and
		// the table's own order is what the numbering rule then judges
		expect(declarations.map((declaration) => declaration.file)).toStrictEqual(['phase2-extra.md', 'phase1-core.md']);
	});

	test('prose above the first block header belongs to no block', () => {
		const { plan } = setupOverview({
			rows: '| 1 | `phase1-core.md` | the core | 0 | 0 |',
			declarations: `These list only what crosses a phase boundary — see \`src/stray.ts\`.

### Phase 1 — \`phase1-core.md\`

- **Creates:** none
- **Exports:** none
- **Scripts:** none`,
		});

		const declarations = parsePhaseDeclarations({ plan });

		// a span in the section's own preamble is not a declaration
		expect(declarations[0]?.creates).toStrictEqual([]);
	});

	test('a row whose file cell names no markdown file is not a phase row', () => {
		const { plan } = setupOverview({ rows: '| 1 | to be decided | the core | 0 | 0 |' });

		expect(parsePhaseDeclarations({ plan })).toStrictEqual([]);
	});

	test('a filename written without backticks still names the phase file', () => {
		const { plan } = setupOverview({ rows: '| 1 | phase1-core.md | the core | 0 | 0 |' });

		const declarations = parsePhaseDeclarations({ plan });

		expect(declarations[0]).toEqual(expect.objectContaining({ file: 'phase1-core.md', scope: 'the core' }));
	});

	test('a row that stops after the filename parses with an empty scope', () => {
		const { plan } = setupOverview({ rows: '| 1 | `phase1-core.md` |' });

		const declarations = parsePhaseDeclarations({ plan });

		expect(declarations[0]).toEqual(expect.objectContaining({ scope: '', createdCount: undefined, touchedCount: undefined }));
	});

	test('the file-budget bullet is read past its label, whatever its casing, and holds none without an integer', () => {
		const { plan } = setupOverview({
			rows: `| 1 | \`phase1-core.md\` | the core | 0 | 0 |
| 2 | \`phase2-extra.md\` | the extra | 0 | 0 |`,
			declarations: `### Phase 1 — \`phase1-core.md\`

- **Creates:** none
- **Exports:** none
- **Scripts:** none
- **File Budget:** 9

### Phase 2 — \`phase2-extra.md\`

- **Creates:** none
- **Exports:** none
- **Scripts:** none
- **File budget:** none`,
		});

		const declarations = parsePhaseDeclarations({ plan });

		expect(declarations.map((declaration) => declaration.fileBudget)).toStrictEqual([9, undefined]);
	});

	test('an overview carrying neither surface declares no phases at all', () => {
		const { plan } = setupBareOverview();

		expect(parsePhaseDeclarations({ plan })).toStrictEqual([]);
	});
});
