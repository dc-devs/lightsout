import { describe, expect, test } from '@jest/globals';
import type { PhaseDeclaration } from '#src/plan/common/types/PhaseDeclaration.ts';
import { parsePhaseDeclarations } from '#src/plan/parsePhaseDeclarations.ts';
import { parsePlan } from '#src/plan/parsePlan.ts';
import { renderPhaseRow } from '#src/plan/sections/renderPhaseRow.ts';

/** One phase record, complete by default so a test states only the field it varies. */
const setupDeclaration = (overrides: Partial<PhaseDeclaration> = {}) => {
	const declaration: PhaseDeclaration = {
		number: 1,
		file: 'phase1-core.md',
		scope: 'the core',
		createdCount: 3,
		touchedCount: 7,
		creates: [],
		exports: [],
		scripts: [],
		fileBudget: undefined,
		...overrides,
	};

	return { declaration };
};

/** The line the rendered row lands on in the overview below — what the parser reports as the row's own provenance. */
const renderedRowLine = 7;

/** The rendered row read back the way the lint reads it: placed in an overview's `## Phases` table and parsed. */
const parseRenderedRow = ({ row }: { row: string }) => {
	const content = `# Demo — Overview

## Phases

| # | File | Scope | Creates | Touches |
|---|------|-------|---------|---------|
${row}

## Cross-Phase Dependencies

- None.
`;

	return parsePhaseDeclarations({ plan: parsePlan({ content, base: 'overview.md' }) });
};

describe('renderPhaseRow', () => {
	test('renders a Phases row that parses back to the same declaration', () => {
		const { declaration } = setupDeclaration({ number: 2, file: 'phase2-evidence.md', scope: 'collected source evidence', createdCount: 12, touchedCount: 13 });

		const row = renderPhaseRow({ declaration });

		expect(parseRenderedRow({ row })).toStrictEqual([{ ...declaration, rowLine: renderedRowLine }]);
	});

	test('renders empty count cells when the declaration states no counts', () => {
		const { declaration } = setupDeclaration({ createdCount: undefined, touchedCount: undefined });

		const row = renderPhaseRow({ declaration });

		expect(parseRenderedRow({ row })).toStrictEqual([{ ...declaration, rowLine: renderedRowLine }]);
		expect(row).not.toContain('undefined');
	});

	test('escapes a pipe in the scope so the row keeps its cells', () => {
		const { declaration } = setupDeclaration({ number: 3, file: 'phase3-sections.md', scope: 'reads | writes', createdCount: 2, touchedCount: 4 });

		const row = renderPhaseRow({ declaration });

		const cells = row.split(/(?<!\\)\|/).slice(1, -1);

		expect(cells.map((cell) => cell.trim())).toStrictEqual(['3', '`phase3-sections.md`', 'reads \\| writes', '2', '4']);
	});
});
