import { describe, expect, test } from '@jest/globals';
import { decisionLogReference } from '#src/plan/decisionLog/decisionLogReference.ts';

// No arrangement: the subject takes no argument and returns the same fixed
// section every call, so the act is the whole setup.

describe('decisionLogReference', () => {
	test("decisionLogReference: points at the overview's log instead of carrying a table", () => {
		const section = decisionLogReference();

		const lines = section.split('\n');
		const body = lines.slice(2).join(' ');
		const backtickedSpans = section.match(/`[^`]*`/g) ?? [];
		expect(lines[0]).toBe('## Decision Log');
		expect(lines[1]).toBe('');
		// the sentence has to name the file a reader opens for the complete log
		expect(body).toContain('overview.md');
		// a table row here would give a phase file a second copy of the history
		// the overview already owns
		expect(lines.filter((line) => line.trimStart().startsWith('|'))).toStrictEqual([]);
		// a backticked span is how this repo's plans state a path, and a path in
		// a plan file is a claim about the working tree — the reference names the
		// overview as a bare file name so it asserts nothing
		expect(backtickedSpans.filter((span) => span.includes('overview.md') || span.includes('/'))).toStrictEqual([]);
	});
});
