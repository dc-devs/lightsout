import { expect, test } from '@jest/globals';
import { buildLedgerTestWriterInvocation } from '#src/agents/index.ts';
import type { LedgerRow } from '#src/contracts/index.ts';

const setupMoves = () => {
	const planContent = '# Plan: move the widget test\n\nPLAN-SENTINEL';
	const rows: LedgerRow[] = [
		{
			criterion: 'a moved widget test still states its criterion',
			testFile: 'src/new/widget.unit.test.ts',
			testName: 'widget: enabled renders its label',
			gate: 'test',
			line: 12,
		},
	];

	return {
		planContent,
		testFile: 'src/new/widget.unit.test.ts',
		rows,
		movePaths: [{ from: 'src/old/widget.unit.test.ts', to: 'src/new/widget.unit.test.ts' }],
		deletePaths: ['src/legacy/widget.unit.test.ts'],
	};
};

test("buildLedgerTestWriterInvocation: the plan's test-side moves and deletes ride the user prompt with the carry-every-case rule", () => {
	const params = setupMoves();

	const { systemPrompt, prompt } = buildLedgerTestWriterInvocation(params);

	// both sides of every move, and every deleted test file, reach the writer
	expect(prompt).toContain('src/old/widget.unit.test.ts');
	expect(prompt).toContain('src/new/widget.unit.test.ts');
	expect(prompt).toContain('src/legacy/widget.unit.test.ts');
	// a move destination this writer writes carries every case its source held
	expect(prompt).toMatch(/every case/i);
	// a file the plan deletes is not somewhere to put a named test
	expect(prompt).toMatch(/delete/i);
	// the per-run moves belong to the assignment, never to the cached prefix
	expect(systemPrompt).not.toContain('src/old/widget.unit.test.ts');
	expect(systemPrompt).not.toContain('src/legacy/widget.unit.test.ts');
	// the report-contract reminder still closes the prompt
	expect(prompt.endsWith('Remember: your entire final message must be exactly one JSON report object — nothing else.')).toBeTruthy();
});
