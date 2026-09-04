import { expect, test } from '@jest/globals';
import { buildLedgerTestWriterInvocation } from '#src/agents/index.ts';
import type { LedgerRow } from '#src/contracts/index.ts';

const planContent = '# Plan: add the widget flag\n\nPLAN-SENTINEL';
const overviewContent = '# Overview\n\nOVERVIEW-SENTINEL';
const standards = '## Tabs only\n\nSTANDARDS-SENTINEL';
const rows: LedgerRow[] = [
	{ criterion: 'a disabled widget renders nothing', testFile: 'src/widget.unit.test.ts', testName: 'widget: disabled renders nothing', gate: 'test', line: 12 },
	{
		criterion: 'an enabled widget renders its label',
		testFile: 'src/widget.unit.test.ts',
		testName: 'widget: enabled renders its label',
		gate: 'test',
		line: 13,
	},
];
const soloParams = { planContent, testFile: 'src/widget.unit.test.ts', rows };

test('buildLedgerTestWriterInvocation: the system prompt carries the role, the overview, the plan, and the standards in that order', () => {
	const { systemPrompt } = buildLedgerTestWriterInvocation({ ...soloParams, overviewContent, standards });

	// the ledger writer is the unit-test-writer role with a different assignment
	expect(systemPrompt.startsWith('# Role: Unit Test Writer')).toBeTruthy();
	expect(systemPrompt.includes('# Overview (high-level context)')).toBeTruthy();
	expect(systemPrompt.includes(`# Plan (context for intended behavior)\n\n${planContent}`)).toBeTruthy();
	expect(systemPrompt.includes(`# Standards\n\nThese rules are binding for the tests you write:\n\n${standards}`)).toBeTruthy();
	// the plan follows the overview, and the standards close the prompt
	expect(systemPrompt.indexOf('OVERVIEW-SENTINEL') < systemPrompt.indexOf('PLAN-SENTINEL')).toBeTruthy();
	expect(systemPrompt.indexOf('PLAN-SENTINEL') < systemPrompt.indexOf('STANDARDS-SENTINEL')).toBeTruthy();
});

test('buildLedgerTestWriterInvocation: absent optional inputs emit no section rather than an empty one', () => {
	const { systemPrompt, prompt } = buildLedgerTestWriterInvocation({ ...soloParams, overviewContent: '', standards: '', errorContext: '' });

	expect(systemPrompt.includes('# Overview (high-level context)')).toBeFalsy();
	expect(systemPrompt.includes('# Standards\n\nThese rules are binding')).toBeFalsy();
	expect(prompt.includes('# Missing tests')).toBeFalsy();
});

test('buildLedgerTestWriterInvocation: the system prompt is byte-identical across the spawns of one fan-out', () => {
	const first = buildLedgerTestWriterInvocation({ ...soloParams, standards });
	const second = buildLedgerTestWriterInvocation({
		planContent,
		testFile: 'src/other.unit.test.ts',
		rows: [{ criterion: 'other', testFile: 'src/other.unit.test.ts', testName: 'other: works', gate: 'test', line: 20 }],
		standards,
	});
	const repair = buildLedgerTestWriterInvocation({ ...soloParams, standards, errorContext: '- `widget: enabled renders its label`' });

	// a different file cannot break the cached prefix, and neither can the one
	// repair re-invocation
	expect(first.systemPrompt).toBe(second.systemPrompt);
	expect(first.systemPrompt).toBe(repair.systemPrompt);
});

test('buildLedgerTestWriterInvocation: the user prompt names the file, every row, and the binding rules', () => {
	const { prompt } = buildLedgerTestWriterInvocation({ ...soloParams, standards });

	// the assignment leads the prompt and names the one file this writer owns
	expect(prompt.startsWith('# Ledger tests to write\n\nWrite these tests, and only these, in `src/widget.unit.test.ts`:')).toBeTruthy();
	// each row arrives as its criterion, the exact test name, and its gate
	expect(prompt.includes('- criterion: a disabled widget renders nothing\n  - test name: `widget: disabled renders nothing`\n  - gate: test')).toBeTruthy();
	expect(prompt.includes('- test name: `widget: enabled renders its label`')).toBeTruthy();
	// the rules that make the ledger binding
	expect(prompt.includes('using each test name verbatim')).toBeTruthy();
	expect(prompt.includes('The source under test may not exist on disk yet')).toBeTruthy();
	expect(prompt.includes('add the named cases and change nothing else in it')).toBeTruthy();
	expect(prompt.includes('Run nothing')).toBeTruthy();
	expect(prompt.includes('is a plan defect')).toBeTruthy();
	// the report-contract reminder closes the prompt
	expect(prompt.endsWith('Remember: your entire final message must be exactly one JSON report object — nothing else.')).toBeTruthy();
});

test('buildLedgerTestWriterInvocation: neither the plan nor the standards appear in the user prompt', () => {
	const { prompt } = buildLedgerTestWriterInvocation({ ...soloParams, overviewContent, standards });

	// everything stable across the fan-out is paid for once, in the cached
	// system prompt
	expect(prompt.includes('PLAN-SENTINEL')).toBeFalsy();
	expect(prompt.includes('STANDARDS-SENTINEL')).toBeFalsy();
	expect(prompt.includes('OVERVIEW-SENTINEL')).toBeFalsy();
});

test('buildLedgerTestWriterInvocation: the missing-tests section rides the user prompt, only on the repair re-invocation', () => {
	const clean = buildLedgerTestWriterInvocation(soloParams);
	const repair = buildLedgerTestWriterInvocation({ ...soloParams, errorContext: '- `widget: enabled renders its label`' });

	expect(clean.prompt.includes('# Missing tests')).toBeFalsy();
	// the names land verbatim, and the section says to leave the rest alone
	expect(repair.prompt.includes('# Missing tests')).toBeTruthy();
	expect(repair.prompt.includes('- `widget: enabled renders its label`')).toBeTruthy();
	expect(repair.prompt.includes('leaving the rest of the file alone')).toBeTruthy();
	// the report-contract reminder still closes the prompt
	expect(repair.prompt.endsWith('Remember: your entire final message must be exactly one JSON report object — nothing else.')).toBeTruthy();
});

test('buildLedgerTestWriterInvocation: the role prompt says the ledger assignment replaces the subject rules', () => {
	const { systemPrompt } = buildLedgerTestWriterInvocation(soloParams);
	// the prompt wraps its lines; the sentences are what matter
	const prose = systemPrompt.replace(/\s+/g, ' ');

	// the section keys off the same heading the user prompt leads with
	expect(prose).toContain('When your task carries a `# Ledger tests to write` section');
	expect(prose).toContain('the rules of that section replace the subject rules above');
	// the writer is told to trust the plan over the disk, and to run nothing
	expect(prose).toContain('The source under test may not exist on disk yet');
	expect(prose).toContain('do not run anything to check');
	// a row the plan cannot support is reported, never invented around
	expect(prose).toContain('is a plan defect: report `failed` naming the row');
});
