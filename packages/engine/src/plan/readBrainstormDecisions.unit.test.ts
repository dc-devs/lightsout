import { execSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, test } from '@jest/globals';
import { readBrainstormDecisions } from '#src/plan/readBrainstormDecisions.ts';
import { getRejectionError } from '#tests/helpers/getRejectionError.ts';
import { setupBranchRepo } from '#tests/helpers/setupBranchRepo.ts';

/**
 * A temp repo whose plan workspace holds the given raw `brainstorm-decisions.json`.
 * Omitting `content` leaves the workspace without one — the no-brainstorm path.
 */
const setupWorkspace = ({ name = 'grill-me', content }: { name?: string; content?: string } = {}) => {
	const cwd = mkdtempSync(join(tmpdir(), 'lightsout-brainstorm-'));
	const brainstormPath = join(cwd, '.lightsout', 'plans', name, 'brainstorm-decisions.json');

	if (content !== undefined) {
		mkdirSync(join(cwd, '.lightsout', 'plans', name), { recursive: true });
		writeFileSync(brainstormPath, content);
	}

	return { cwd, name, brainstormPath };
};

/** One brainstorm-settled Decision-Log row, as `/brainstorm` writes it. */
const decisionRow = {
	source: 'Brainstorm',
	question: 'where do plan deliverables live?',
	options: 'repo root / .claude/plans',
	choice: '.claude/plans',
	rationale: 'the committed, human-reviewed path implement reads',
	assumption: false,
};

/** One plan folder holding the given decision row, under whichever checkout root it is handed. */
const writeDecisions = ({ root, name, choice }: { root: string; name: string; choice: string }) => {
	mkdirSync(join(root, '.lightsout', 'plans', name), { recursive: true });
	writeFileSync(
		join(root, '.lightsout', 'plans', name, 'brainstorm-decisions.json'),
		JSON.stringify({ planName: name, decisions: [{ ...decisionRow, choice }] }),
	);
};

/**
 * A primary checkout with a linked worktree cut from it, each holding a plan
 * folder of the same name with a different settled choice in it — so a read
 * resolving against the checkout it was handed answers the worktree's copy, and
 * only a read resolving the primary answers the one that survives the tree.
 */
const setupWorktreeWorkspace = ({ name = 'grill-me' }: { name?: string } = {}) => {
	const { cwd: primary } = setupBranchRepo();
	const worktree = join(primary, '.worktrees', name);

	execSync(`git worktree add -q -b ${name} "${worktree}" main`, { cwd: primary, stdio: 'ignore' });
	writeDecisions({ root: primary, name, choice: '.claude/plans' });
	writeDecisions({ root: worktree, name, choice: 'the copy inside the tree' });

	return { worktree, name };
};

describe('readBrainstormDecisions', () => {
	test('returns the authored record parsed against the contract', async () => {
		const { cwd, name } = setupWorkspace({ content: JSON.stringify({ planName: 'grill-me', decisions: [decisionRow] }) });

		const record = await readBrainstormDecisions({ cwd, name });

		expect(record).toStrictEqual({ planName: 'grill-me', decisions: [decisionRow] });
	});

	test('returns undefined for an absent file rather than throwing — the no-brainstorm path', async () => {
		const { cwd, name } = setupWorkspace();

		const record = await readBrainstormDecisions({ cwd, name });

		// most plans start from a direct request and never went through /brainstorm
		expect(record).toBe(undefined);
	});

	test('defaults an omitted decisions array to empty rather than failing the read', async () => {
		const { cwd, name } = setupWorkspace({ content: JSON.stringify({ planName: 'grill-me' }) });

		const record = await readBrainstormDecisions({ cwd, name });

		// a record with no rows yet is authored, not corrupt
		expect(record).toStrictEqual({ planName: 'grill-me', decisions: [] });
	});

	test('reads from the plan workspace keyed by name, so two plans never cross', async () => {
		const { cwd } = setupWorkspace({ name: 'plan-a', content: JSON.stringify({ planName: 'plan-a', decisions: [] }) });

		mkdirSync(join(cwd, '.lightsout', 'plans', 'plan-b'), { recursive: true });
		writeFileSync(join(cwd, '.lightsout', 'plans', 'plan-b', 'brainstorm-decisions.json'), JSON.stringify({ planName: 'plan-b', decisions: [decisionRow] }));

		const record = await readBrainstormDecisions({ cwd, name: 'plan-b' });

		// the name selects the workspace, not the first one on disk
		expect(record).toStrictEqual({ planName: 'plan-b', decisions: [decisionRow] });
	});

	test('rejects a brainstorm-decisions.json that is not valid JSON', async () => {
		const { cwd, name } = setupWorkspace({ content: '{"planName": "grill-me",' });

		// a present-but-corrupt file is a hard error — dropping settled decisions
		// silently would re-open them for no reason
		await expect(readBrainstormDecisions({ cwd, name })).rejects.toThrow(SyntaxError);
	});

	test('rejects a row whose source is a plan-dialogue origin, naming the offending field', async () => {
		const { cwd, name } = setupWorkspace({
			content: JSON.stringify({ planName: 'grill-me', decisions: [{ ...decisionRow, source: 'Elicitation' }] }),
		});

		const error = await getRejectionError({ promise: readBrainstormDecisions({ cwd, name }) });

		// only Brainstorm rows belong here — a mislabelled row fails the read
		expect(error.message).toMatch(/source/);
	});

	test('rejects a record missing its plan name, naming the offending field', async () => {
		const { cwd, name } = setupWorkspace({ content: JSON.stringify({ decisions: [decisionRow] }) });

		const error = await getRejectionError({ promise: readBrainstormDecisions({ cwd, name }) });

		// the file was read — it is the shape that failed
		expect(error.message).toMatch(/planName/);
	});

	test("reads the primary checkout's plan folder when asked from inside a linked worktree", async () => {
		const { worktree, name } = setupWorktreeWorkspace();

		const record = await readBrainstormDecisions({ cwd: worktree, name });

		// a planning worktree is removed once its work ships, so the decisions a
		// draft reads are the main checkout's whichever checkout it runs in
		expect(record).toStrictEqual({ planName: 'grill-me', decisions: [{ ...decisionRow, choice: '.claude/plans' }] });
	});

	test('a file that is present but unreadable names the mid-draft race, not the missing-file path', async () => {
		const { cwd, name, brainstormPath } = setupWorkspace();

		// a directory standing where the file should be: access() sees it, readFile cannot
		mkdirSync(brainstormPath, { recursive: true });

		const error = await getRejectionError({ promise: readBrainstormDecisions({ cwd, name }) });

		expect(error.message).toMatch(/became unreadable during drafting/);
	});
});
