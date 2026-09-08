import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, jest, test } from '@jest/globals';
import { readMergedDecisions } from '#src/plan/decisionLog/readMergedDecisions.ts';
import { getRejectionError } from '#tests/helpers/getRejectionError.ts';

// No mocks: the subject reads a plan workspace off disk, so the arrangement is
// a real temporary folder holding exactly the records each case is about.

/** One brainstorm-settled row, as `/brainstorm` writes it. */
const brainstormRow = {
	source: 'Brainstorm',
	question: 'where do plan deliverables live?',
	options: 'repo root / .claude/plans',
	choice: '.claude/plans',
	rationale: 'the committed, human-reviewed path implement reads',
	assumption: false,
};

/** One row from the plan's own interview, as the session writes it. */
const planRow = {
	source: 'Elicitation',
	question: 'who owns the Decision Log?',
	options: 'the engine / the plan-writer model',
	choice: 'the engine',
	rationale: 'one authoritative record, rendered rather than re-typed',
	assumption: false,
};

/**
 * A temp repo whose plan workspace holds the given raw records. Omitting
 * `decisions` leaves the plan's own record unauthored — the missing-file path.
 */
const setupWorkspace = ({ decisions, brainstorm }: { decisions?: string; brainstorm?: string } = {}) => {
	const cwd = mkdtempSync(join(tmpdir(), 'lightsout-merged-decisions-'));
	const name = 'lo-127-generated-decision-history';
	const workspaceDir = join(cwd, '.lightsout', 'plans', name);
	const decisionsPath = join(workspaceDir, 'decisions.json');

	mkdirSync(workspaceDir, { recursive: true });

	if (decisions !== undefined) {
		writeFileSync(decisionsPath, decisions);
	}

	if (brainstorm !== undefined) {
		writeFileSync(join(workspaceDir, 'brainstorm-decisions.json'), brainstorm);
	}

	return { cwd, name, decisionsPath };
};

describe('readMergedDecisions', () => {
	test("readMergedDecisions: puts every brainstorm row ahead of the plan's own", async () => {
		const { cwd, name } = setupWorkspace({
			decisions: JSON.stringify({ planName: 'lo-127-generated-decision-history', decisions: [planRow] }),
			brainstorm: JSON.stringify({ planName: 'lo-127-generated-decision-history', decisions: [brainstormRow] }),
		});

		const result = await readMergedDecisions({ cwd, name });

		// the merge order is the order the log renders in, so brainstorm rows lead
		expect(result).toStrictEqual({
			merged: { planName: 'lo-127-generated-decision-history', decisions: [brainstormRow, planRow] },
			brainstorm: { planName: 'lo-127-generated-decision-history', decisions: [brainstormRow] },
		});
	});

	test("readMergedDecisions: returns the plan's own rows unmerged when the workspace holds no brainstorm record", async () => {
		const { cwd, name } = setupWorkspace({
			decisions: JSON.stringify({ planName: 'lo-127-generated-decision-history', decisions: [planRow] }),
		});
		const progress = jest.fn<(message: string) => void>();

		const result = await readMergedDecisions({ cwd, name, onProgress: progress });

		// most plans never went through `/brainstorm`, so an absent record is a
		// normal path: the plan's own record comes back as it was read, and the
		// progress line says the draft is working from those rows alone
		expect(result).toStrictEqual({
			merged: { planName: 'lo-127-generated-decision-history', decisions: [planRow] },
			brainstorm: undefined,
		});
		expect(progress).toHaveBeenCalledWith(expect.stringContaining('no brainstorm decisions'));
	});

	test('readMergedDecisions: rejects naming decisions.json when the record is missing', async () => {
		const { cwd, name, decisionsPath } = setupWorkspace({
			brainstorm: JSON.stringify({ planName: 'lo-127-generated-decision-history', decisions: [brainstormRow] }),
		});

		const error = await getRejectionError({ promise: readMergedDecisions({ cwd, name }) });

		// a silent empty record would render a log the session never authored
		expect(error.message).toContain(decisionsPath);
	});
});
