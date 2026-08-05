import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildUnitTestWriterInvocation } from '@/agents';

const planContent = '# Plan: add the widget flag\n\nPLAN-SENTINEL';
const standards = '## Tabs only\n\nSTANDARDS-SENTINEL';

test('buildUnitTestWriterInvocation: the system prompt carries the role, the plan, and the standards as labelled sections', () => {
	const { systemPrompt } = buildUnitTestWriterInvocation({ planContent, changedFiles: ['src/widget.ts'], standards });

	assert.ok(systemPrompt.startsWith('# Role: Unit Test Writer'), 'the role prompt leads the system prompt');
	assert.ok(systemPrompt.includes(`\n\n---\n\n# Plan (context for intended behavior)\n\n${planContent}`), 'the plan is appended as a labelled section');
	assert.ok(systemPrompt.includes(`# Standards\n\nThese rules are binding for the tests you write:\n\n${standards}`), 'the standards land verbatim');
});

test('buildUnitTestWriterInvocation: no standards section when standards are absent', () => {
	const { systemPrompt } = buildUnitTestWriterInvocation({ planContent, changedFiles: ['src/widget.ts'] });

	assert.ok(!systemPrompt.includes('# Standards\n\nThese rules are binding'), 'the standards section is omitted, not emptied');
});

test('buildUnitTestWriterInvocation: the system prompt is byte-identical across the spawns of one fan-out', () => {
	const first = buildUnitTestWriterInvocation({ planContent, changedFiles: ['src/widget.ts'], standards });
	const second = buildUnitTestWriterInvocation({ planContent, changedFiles: ['src/other.ts', 'src/internal.ts'], standards });
	const fix = buildUnitTestWriterInvocation({ planContent, changedFiles: ['src/widget.ts'], standards, errorContext: 'test-unit failed' });

	assert.equal(first.systemPrompt, second.systemPrompt, 'a different target group cannot break the cached prefix');
	assert.equal(first.systemPrompt, fix.systemPrompt, 'a fix re-invocation shares the writers cached prefix');
});

test('buildUnitTestWriterInvocation: the user prompt carries the target group, the group note only for multi-file groups, and the report reminder', () => {
	const solo = buildUnitTestWriterInvocation({ planContent, changedFiles: ['src/widget.ts'], standards });
	const group = buildUnitTestWriterInvocation({ planContent, changedFiles: ['src/widget.ts', 'src/internal.ts'], standards });

	assert.ok(solo.prompt.startsWith('# Changed files to cover\n\n- src/widget.ts'), 'the role marker the engine classifies on leads the prompt');
	assert.ok(!solo.prompt.includes('These files changed together'), 'a single-file group carries no group note');
	assert.ok(group.prompt.includes('- src/widget.ts\n- src/internal.ts'), 'every file in the group gets its own bullet');
	assert.ok(group.prompt.includes('These files changed together'), 'a multi-file group carries the boundary-coverage instruction');
	assert.ok(solo.prompt.includes('one JSON report object'), 'the report-contract reminder closes the prompt');
});

test('buildUnitTestWriterInvocation: the verification-failure section rides the user prompt, only on a fix re-invocation', () => {
	const clean = buildUnitTestWriterInvocation({ planContent, changedFiles: ['src/widget.ts'] });
	const fix = buildUnitTestWriterInvocation({ planContent, changedFiles: ['src/widget.ts'], errorContext: 'GATE-SENTINEL' });

	assert.ok(!clean.prompt.includes('# Verification failure'));
	assert.ok(fix.prompt.includes('# Verification failure'));
	assert.ok(fix.prompt.includes('GATE-SENTINEL'), 'the gate output lands verbatim');
});

test('buildUnitTestWriterInvocation: neither the plan nor the standards appear in the user prompt', () => {
	const { prompt } = buildUnitTestWriterInvocation({ planContent, changedFiles: ['src/widget.ts'], standards });

	assert.ok(!prompt.includes('PLAN-SENTINEL'), 'the plan is paid for once, in the cached system prompt');
	assert.ok(!prompt.includes('STANDARDS-SENTINEL'), 'the standards are paid for once, in the cached system prompt');
});

test('buildUnitTestWriterInvocation: the system prompt fences its sections with a horizontal rule, in a deterministic order', () => {
	const { systemPrompt } = buildUnitTestWriterInvocation({ planContent, changedFiles: ['src/widget.ts'], standards });

	assert.ok(systemPrompt.includes('\n\n---\n\n# Standards\n\n'), 'the standards are fenced off from the plan');
	assert.ok(
		systemPrompt.indexOf('# Plan (context for intended behavior)') < systemPrompt.indexOf('\n\n---\n\n# Standards\n\n'),
		'section order is role, then plan, then standards',
	);
});

test('buildUnitTestWriterInvocation: the plan section survives, fenced, when no standards are supplied', () => {
	const { systemPrompt } = buildUnitTestWriterInvocation({ planContent, changedFiles: ['src/widget.ts'] });

	assert.ok(
		systemPrompt.endsWith(`\n\n---\n\n# Plan (context for intended behavior)\n\n${planContent}`),
		'the plan closes a standards-free system prompt, still fenced off from the role',
	);
});

test('buildUnitTestWriterInvocation: empty optional inputs emit no section rather than an empty one', () => {
	const { systemPrompt, prompt } = buildUnitTestWriterInvocation({ planContent, changedFiles: ['src/widget.ts'], standards: '', errorContext: '' });

	assert.ok(!systemPrompt.includes('# Standards\n\nThese rules are binding'), 'an empty standards string emits no standards section');
	assert.ok(!prompt.includes('# Verification failure'), 'an empty error context emits no verification-failure section');
});

test('buildUnitTestWriterInvocation: a solo target group user prompt is the file list and the report reminder alone', () => {
	const { prompt } = buildUnitTestWriterInvocation({ planContent, changedFiles: ['src/widget.ts'], standards });

	assert.equal(prompt, '# Changed files to cover\n\n- src/widget.ts\n\nRemember: your entire final message must be exactly one JSON report object — nothing else.');
});

test('buildUnitTestWriterInvocation: the report reminder closes the user prompt, after the verification failure', () => {
	const { prompt } = buildUnitTestWriterInvocation({ planContent, changedFiles: ['src/widget.ts'], errorContext: 'GATE-SENTINEL' });

	assert.ok(prompt.startsWith('# Changed files to cover'), 'the target group still leads a fix re-invocation');
	assert.ok(prompt.indexOf('# Verification failure') > prompt.indexOf('- src/widget.ts'), 'the gate output follows the target group');
	assert.ok(
		prompt.endsWith('Remember: your entire final message must be exactly one JSON report object — nothing else.'),
		'the report-contract reminder closes the prompt',
	);
});

test('buildUnitTestWriterInvocation: an empty target group emits the header with no bullets and no group note', () => {
	const { prompt } = buildUnitTestWriterInvocation({ planContent, changedFiles: [], standards });

	assert.ok(prompt.startsWith('# Changed files to cover'), 'the role marker the engine classifies on still leads the prompt');
	assert.ok(!prompt.includes('\n- '), 'no bullet is emitted for an empty group');
	assert.ok(!prompt.includes('These files changed together'), 'an empty group carries no group note');
});
