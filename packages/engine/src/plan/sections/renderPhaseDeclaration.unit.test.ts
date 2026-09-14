import { describe, expect, test } from '@jest/globals';
import type { PhaseDeclaration } from '#src/plan/common/types/PhaseDeclaration.ts';
import { parsePhaseDeclarations } from '#src/plan/parsePhaseDeclarations.ts';
import { parsePlan } from '#src/plan/parsePlan.ts';
import { renderPhaseDeclaration } from '#src/plan/sections/index.ts';

/** One phase record, complete by default so a test states only the field it varies. */
const setupDeclaration = (overrides: Partial<PhaseDeclaration> = {}) => {
	const declaration: PhaseDeclaration = {
		number: 1,
		file: 'phase1-core.md',
		scope: 'the core',
		createdCount: 1,
		touchedCount: 2,
		creates: ['packages/engine/src/core.ts'],
		exports: ['buildCore'],
		scripts: ['check:core'],
		fileBudget: undefined,
		...overrides,
	};

	return { declaration };
};

/** A phase declaring a file budget beside one declaring none — the contrast the budget bullet turns on. */
const setupBudgetContrast = () => {
	const { declaration: budgeted } = setupDeclaration({ fileBudget: 12 });
	const { declaration: unbudgeted } = setupDeclaration({ number: 2, file: 'phase2-wiring.md', scope: 'the wiring' });

	return { budgeted, unbudgeted };
};

/**
 * A rendered block read back the way the lint reads an overview: pasted into a
 * `## Phase Declarations` section beside the `## Phases` rows that join to it,
 * so the parser returns a joined declaration rather than an orphan.
 */
const parseBack = ({ block, rows }: { block: string; rows: string }) => {
	const content = `# Demo — Overview

## Phases

| # | File | Scope | Creates | Touches |
|---|------|-------|---------|---------|
${rows}

## Phase Declarations

${block}

## Cross-Phase Dependencies

- None.
`;

	return parsePhaseDeclarations({ plan: parsePlan({ content, base: 'overview.md' }) });
};

describe('renderPhaseDeclaration', () => {
	test('renders a declaration block that parses back to the same creates, exports and scripts', () => {
		const { declaration } = setupDeclaration({
			creates: ['packages/engine/src/core.ts', 'packages/engine/src/core/buildCore.ts'],
			exports: ['buildCore', 'CoreOptions'],
			scripts: ['check:core'],
		});

		const block = renderPhaseDeclaration({ declaration });
		const [parsed] = parseBack({ block, rows: '| 1 | `phase1-core.md` | the core | 2 | 2 |' });

		expect(parsed).toEqual(
			expect.objectContaining({
				number: 1,
				file: 'phase1-core.md',
				creates: ['packages/engine/src/core.ts', 'packages/engine/src/core/buildCore.ts'],
				exports: ['buildCore', 'CoreOptions'],
				scripts: ['check:core'],
			}),
		);
	});

	test('renders the nothing-to-declare sentinel for an empty bullet', () => {
		const { declaration } = setupDeclaration({ creates: [], exports: [], scripts: [] });

		const block = renderPhaseDeclaration({ declaration });
		const [parsed] = parseBack({ block, rows: '| 1 | `phase1-core.md` | the core | 0 | 0 |' });

		expect(block).toMatch(/^-\s+\*\*Creates:\*\*\s+(?:none|None)\s*$/m);
		expect(block).toMatch(/^-\s+\*\*Exports:\*\*\s+(?:none|None)\s*$/m);
		expect(block).toMatch(/^-\s+\*\*Scripts:\*\*\s+(?:none|None)\s*$/m);
		expect(parsed).toEqual(expect.objectContaining({ creates: [], exports: [], scripts: [] }));
	});

	test('renders the file-budget bullet only when the declaration states a budget', () => {
		const { budgeted, unbudgeted } = setupBudgetContrast();

		const budgetedBlock = renderPhaseDeclaration({ declaration: budgeted });
		const unbudgetedBlock = renderPhaseDeclaration({ declaration: unbudgeted });

		expect(budgetedBlock).toMatch(/^-\s+\*\*File budget:\*\*\s+12\s*$/m);
		expect(unbudgetedBlock).not.toMatch(/File budget/i);
		expect(parseBack({ block: budgetedBlock, rows: '| 1 | `phase1-core.md` | the core | 1 | 2 |' })[0]).toEqual(expect.objectContaining({ fileBudget: 12 }));
		expect(parseBack({ block: unbudgetedBlock, rows: '| 2 | `phase2-wiring.md` | the wiring | 1 | 2 |' })[0]).toEqual(
			expect.objectContaining({ fileBudget: undefined }),
		);
	});
});
