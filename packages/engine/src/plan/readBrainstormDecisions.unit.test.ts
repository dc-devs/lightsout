import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, test } from '@jest/globals';
import { getRejectionError } from '@tests/helpers/getRejectionError';
import { readBrainstormDecisions } from '@/plan';

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

	test('a file that is present but unreadable names the mid-draft race, not the missing-file path', async () => {
		const { cwd, name, brainstormPath } = setupWorkspace();

		// a directory standing where the file should be: access() sees it, readFile cannot
		mkdirSync(brainstormPath, { recursive: true });

		const error = await getRejectionError({ promise: readBrainstormDecisions({ cwd, name }) });

		expect(error.message).toMatch(/became unreadable during drafting/);
	});
});
