import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, test } from '@jest/globals';
import { confirmCitation } from '#src/plan/common/memory/confirmCitation.ts';
import { freshCwd } from '#tests/helpers/freshCwd.ts';

/**
 * Exactly 24 characters, and its 23-character prefix — the pair that states the
 * floor through the function's behaviour rather than by importing the number.
 * Both are present in the plan text, so length is the only thing between them.
 */
const shortestAcceptedQuote = 'the queue owner is Dana.';
const oneCharacterTooShort = 'the queue owner is Dana';

const plannedLine = 'The judge that times out leaves its own record open and blocking.';

const planText = `# Phase 1\n\n## Decision Log\n\n| 1 | Grill | ${shortestAcceptedQuote} | who owns the queue |\n\n${plannedLine}\n`;

/** A repo with one file on disk, so the path arm has both a hit and a miss to answer. */
const setupCitations = async () => {
	const cwd = await freshCwd();

	await mkdir(join(cwd, 'src'), { recursive: true });
	await writeFile(join(cwd, 'src/answer.ts'), 'export const answer = 1;\n', 'utf8');

	return { cwd, planText };
};

describe('confirmCitation', () => {
	test('a citation is confirmed as a long-enough verbatim quote or as a file on disk, and refused otherwise', async () => {
		const { cwd } = await setupCitations();

		const verbatim = await confirmCitation({ cwd, citation: plannedLine, planText });
		const collapsed = await confirmCitation({ cwd, citation: '  The JUDGE   that\n  Times Out leaves its OWN record open  ', planText });
		const atTheFloor = await confirmCitation({ cwd, citation: shortestAcceptedQuote, planText });
		const belowTheFloor = await confirmCitation({ cwd, citation: oneCharacterTooShort, planText });
		const absent = await confirmCitation({ cwd, citation: 'the plan names the owner of every queue in this repository', planText });
		const pathOnDisk = await confirmCitation({ cwd, citation: 'src/answer.ts', planText });
		const pathWithLine = await confirmCitation({ cwd, citation: 'src/answer.ts:12', planText });
		const pathNotOnDisk = await confirmCitation({ cwd, citation: 'src/ghost.ts', planText });

		// a quote the plan states is the evidence a record closes on, and the match
		// survives the rewrapping and re-casing a judge does when it pastes a line
		expect(verbatim).toEqual({ ok: true });
		expect(collapsed).toEqual({ ok: true });

		// the floor is what stops a heading or a stock phrase from closing a record:
		// both of these are in the plan text, so only their length separates them
		expect(atTheFloor).toEqual({ ok: true });
		expect(belowTheFloor).toEqual(expect.objectContaining({ ok: false, reason: expect.stringContaining(oneCharacterTooShort) }));
		expect(absent).toEqual(
			expect.objectContaining({ ok: false, reason: expect.stringContaining('the plan names the owner of every queue in this repository') }),
		);

		// a path is the one citation checked against the repository instead of the
		// plan text, which is why none of these three is quoted anywhere in it
		expect(pathOnDisk).toEqual({ ok: true });
		expect(pathWithLine).toEqual({ ok: true });
		expect(pathNotOnDisk).toEqual(expect.objectContaining({ ok: false, reason: expect.stringContaining('src/ghost.ts') }));
	});
});
