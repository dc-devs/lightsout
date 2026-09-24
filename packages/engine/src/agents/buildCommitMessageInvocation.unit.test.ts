import { expect, test } from '@jest/globals';
import { buildCommitMessageInvocation } from '#src/agents/index.ts';

/** Each input carries its own sentinel, so where it lands in the invocation — and whether it leaks into the role prompt — shows. */
const inputs = {
	reference: 'LO-167-REFERENCE-SENTINEL',
	context: 'Plan 001-commit-messages: Commit messages that describe the change — CONTEXT-SENTINEL',
	stat: ' src/widget.ts | 3 ++-\n 1 file changed, 2 insertions(+), 1 deletion(-) STAT-SENTINEL',
	diff: 'diff --git a/src/widget.ts b/src/widget.ts\n+export const widget = 1; // DIFF-SENTINEL',
	truncated: false,
};

/** The prompt's text between the end of the diff and its closing report reminder — where a truncation note would sit. */
const readAfterDiff = ({ prompt, diff }: { prompt: string; diff: string }) => {
	const diffEnd = prompt.indexOf(diff) + diff.length;
	const reminderStart = prompt.lastIndexOf('\n\n');

	return prompt.slice(diffEnd, reminderStart);
};

test('buildCommitMessageInvocation: carries the reference, the reason, the file list and the diff in the prompt, with one fixed role prompt as the system prompt', () => {
	const other = { reference: 'LO-999', context: 'something else entirely', stat: ' other.ts | 1 +', diff: '+other', truncated: true };

	const { systemPrompt, prompt } = buildCommitMessageInvocation(inputs);
	const otherInvocation = buildCommitMessageInvocation(other);

	// the four sections appear in order, each holding its own input
	const ticketAt = prompt.indexOf('# Ticket');
	const reasonAt = prompt.indexOf('# Why this work was done');
	const filesAt = prompt.indexOf('# Files changed');
	const stagedAt = prompt.indexOf('# Staged change');
	expect(ticketAt).toBeGreaterThanOrEqual(0);
	expect(reasonAt).toBeGreaterThan(ticketAt);
	expect(filesAt).toBeGreaterThan(reasonAt);
	expect(stagedAt).toBeGreaterThan(filesAt);
	expect(prompt.indexOf('LO-167-REFERENCE-SENTINEL')).toBeGreaterThan(ticketAt);
	expect(prompt.indexOf('LO-167-REFERENCE-SENTINEL')).toBeLessThan(reasonAt);
	expect(prompt.indexOf('CONTEXT-SENTINEL')).toBeGreaterThan(reasonAt);
	expect(prompt.indexOf('CONTEXT-SENTINEL')).toBeLessThan(filesAt);
	expect(prompt.indexOf('STAT-SENTINEL')).toBeGreaterThan(filesAt);
	expect(prompt.indexOf('STAT-SENTINEL')).toBeLessThan(stagedAt);
	// the diff sits verbatim under its heading, not inside a code fence its own content could close
	expect(prompt).toContain(`# Staged change\n\n${inputs.diff}`);
	// the prompt ends on the JSON-report reminder
	expect(prompt.slice(prompt.lastIndexOf('\n\n'))).toMatch(/JSON/);
	// the role prompt leads the system prompt and nothing about this commit reaches it
	expect(systemPrompt.startsWith('# Role')).toBeTruthy();
	expect(systemPrompt).not.toContain('LO-167-REFERENCE-SENTINEL');
	expect(systemPrompt).not.toContain('CONTEXT-SENTINEL');
	expect(systemPrompt).not.toContain('STAT-SENTINEL');
	expect(systemPrompt).not.toContain('DIFF-SENTINEL');
	// only the user prompt varies between invocations, so the role prompt is one fixed text
	expect(otherInvocation.systemPrompt).toBe(systemPrompt);
});

test('buildCommitMessageInvocation: says the diff was cut only when the staged change was truncated', () => {
	const cut = { ...inputs, truncated: true };
	const whole = { ...inputs, truncated: false };

	const cutInvocation = buildCommitMessageInvocation(cut);
	const wholeInvocation = buildCommitMessageInvocation(whole);
	const cutNote = readAfterDiff({ prompt: cutInvocation.prompt, diff: cut.diff });
	const wholeNote = readAfterDiff({ prompt: wholeInvocation.prompt, diff: whole.diff });

	// a truncated diff is followed by a note saying it was cut and that the file list is the complete record
	expect(cutNote).toMatch(/cut/i);
	expect(cutNote).toMatch(/complete/i);
	// a whole diff runs straight into the closing reminder, with no note between
	expect(wholeNote.trim()).toBe('');
	expect(wholeInvocation.prompt).not.toBe(cutInvocation.prompt);
});
