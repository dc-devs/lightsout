import { expect, test } from '@jest/globals';
import { buildUnitTestWriterInvocation } from '@/agents';

const planContent = '# Plan: add the widget flag\n\nPLAN-SENTINEL';
const standards = '## Tabs only\n\nSTANDARDS-SENTINEL';

test('buildUnitTestWriterInvocation: the system prompt carries the role, the plan, and the standards as labelled sections', () => {
	const { systemPrompt } = buildUnitTestWriterInvocation({ planContent, changedFiles: ['src/widget.ts'], standards });

	// the role prompt leads the system prompt
	expect(systemPrompt.startsWith('# Role: Unit Test Writer')).toBeTruthy();
	// the plan is appended as a labelled section
	expect(systemPrompt.includes(`\n\n---\n\n# Plan (context for intended behavior)\n\n${planContent}`)).toBeTruthy();
	// the standards land verbatim
	expect(systemPrompt.includes(`# Standards\n\nThese rules are binding for the tests you write:\n\n${standards}`)).toBeTruthy();
});

test('buildUnitTestWriterInvocation: no standards section when standards are absent', () => {
	const { systemPrompt } = buildUnitTestWriterInvocation({ planContent, changedFiles: ['src/widget.ts'] });

	// the standards section is omitted, not emptied
	expect(systemPrompt.includes('# Standards\n\nThese rules are binding')).toBeFalsy();
});

test('buildUnitTestWriterInvocation: the system prompt is byte-identical across the spawns of one fan-out', () => {
	const first = buildUnitTestWriterInvocation({ planContent, changedFiles: ['src/widget.ts'], standards });
	const second = buildUnitTestWriterInvocation({ planContent, changedFiles: ['src/other.ts', 'src/internal.ts'], standards });
	const fix = buildUnitTestWriterInvocation({ planContent, changedFiles: ['src/widget.ts'], standards, errorContext: 'test-unit failed' });

	// a different target group cannot break the cached prefix
	expect(first.systemPrompt).toBe(second.systemPrompt);
	// a fix re-invocation shares the writers cached prefix
	expect(first.systemPrompt).toBe(fix.systemPrompt);
});

test('buildUnitTestWriterInvocation: the user prompt carries the target group, the group note only for multi-file groups, and the report reminder', () => {
	const solo = buildUnitTestWriterInvocation({ planContent, changedFiles: ['src/widget.ts'], standards });
	const group = buildUnitTestWriterInvocation({ planContent, changedFiles: ['src/widget.ts', 'src/internal.ts'], standards });

	// the role marker the engine classifies on leads the prompt
	expect(solo.prompt.startsWith('# Changed files to cover\n\n- src/widget.ts')).toBeTruthy();
	// a single-file group carries no group note
	expect(solo.prompt.includes('These files changed together')).toBeFalsy();
	// every file in the group gets its own bullet
	expect(group.prompt.includes('- src/widget.ts\n- src/internal.ts')).toBeTruthy();
	// a multi-file group carries the boundary-coverage instruction
	expect(group.prompt.includes('These files changed together')).toBeTruthy();
	// the report-contract reminder closes the prompt
	expect(solo.prompt.includes('one JSON report object')).toBeTruthy();
});

test('buildUnitTestWriterInvocation: the verification-failure section rides the user prompt, only on a fix re-invocation', () => {
	const clean = buildUnitTestWriterInvocation({ planContent, changedFiles: ['src/widget.ts'] });
	const fix = buildUnitTestWriterInvocation({ planContent, changedFiles: ['src/widget.ts'], errorContext: 'GATE-SENTINEL' });

	expect(clean.prompt.includes('# Verification failure')).toBeFalsy();
	expect(fix.prompt.includes('# Verification failure')).toBeTruthy();
	// the gate output lands verbatim
	expect(fix.prompt.includes('GATE-SENTINEL')).toBeTruthy();
});

test('buildUnitTestWriterInvocation: neither the plan nor the standards appear in the user prompt', () => {
	const { prompt } = buildUnitTestWriterInvocation({ planContent, changedFiles: ['src/widget.ts'], standards });

	// the plan is paid for once, in the cached system prompt
	expect(prompt.includes('PLAN-SENTINEL')).toBeFalsy();
	// the standards are paid for once, in the cached system prompt
	expect(prompt.includes('STANDARDS-SENTINEL')).toBeFalsy();
});

test('buildUnitTestWriterInvocation: the system prompt fences its sections with a horizontal rule, in a deterministic order', () => {
	const { systemPrompt } = buildUnitTestWriterInvocation({ planContent, changedFiles: ['src/widget.ts'], standards });

	// the standards are fenced off from the plan
	expect(systemPrompt.includes('\n\n---\n\n# Standards\n\n')).toBeTruthy();
	// section order is role, then plan, then standards
	expect(systemPrompt.indexOf('# Plan (context for intended behavior)') < systemPrompt.indexOf('\n\n---\n\n# Standards\n\n')).toBeTruthy();
});

test('buildUnitTestWriterInvocation: the plan section survives, fenced, when no standards are supplied', () => {
	const { systemPrompt } = buildUnitTestWriterInvocation({ planContent, changedFiles: ['src/widget.ts'] });

	// the plan closes a standards-free system prompt, still fenced off from the
	// role
	expect(systemPrompt.endsWith(`\n\n---\n\n# Plan (context for intended behavior)\n\n${planContent}`)).toBeTruthy();
});

test('buildUnitTestWriterInvocation: empty optional inputs emit no section rather than an empty one', () => {
	const { systemPrompt, prompt } = buildUnitTestWriterInvocation({ planContent, changedFiles: ['src/widget.ts'], standards: '', errorContext: '' });

	// an empty standards string emits no standards section
	expect(systemPrompt.includes('# Standards\n\nThese rules are binding')).toBeFalsy();
	// an empty error context emits no verification-failure section
	expect(prompt.includes('# Verification failure')).toBeFalsy();
});

test('buildUnitTestWriterInvocation: a solo target group user prompt is the file list and the report reminder alone', () => {
	const { prompt } = buildUnitTestWriterInvocation({ planContent, changedFiles: ['src/widget.ts'], standards });

	expect(prompt).toBe('# Changed files to cover\n\n- src/widget.ts\n\nRemember: your entire final message must be exactly one JSON report object — nothing else.');
});

test('buildUnitTestWriterInvocation: the report reminder closes the user prompt, after the verification failure', () => {
	const { prompt } = buildUnitTestWriterInvocation({ planContent, changedFiles: ['src/widget.ts'], errorContext: 'GATE-SENTINEL' });

	// the target group still leads a fix re-invocation
	expect(prompt.startsWith('# Changed files to cover')).toBeTruthy();
	// the gate output follows the target group
	expect(prompt.indexOf('# Verification failure') > prompt.indexOf('- src/widget.ts')).toBeTruthy();
	// the report-contract reminder closes the prompt
	expect(prompt.endsWith('Remember: your entire final message must be exactly one JSON report object — nothing else.')).toBeTruthy();
});

test('buildUnitTestWriterInvocation: an empty target group emits the header with no bullets and no group note', () => {
	const { prompt } = buildUnitTestWriterInvocation({ planContent, changedFiles: [], standards });

	// the role marker the engine classifies on still leads the prompt
	expect(prompt.startsWith('# Changed files to cover')).toBeTruthy();
	// no bullet is emitted for an empty group
	expect(prompt.includes('\n- ')).toBeFalsy();
	// an empty group carries no group note
	expect(prompt.includes('These files changed together')).toBeFalsy();
});
