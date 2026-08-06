import { expect, describe, test } from '@jest/globals';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readDecisions } from '@/plan';
import { getRejectionError } from '@tests/helpers/getRejectionError';

/**
 * A temp repo whose plan workspace holds the given raw `decisions.json`.
 * Omitting `content` leaves the workspace unauthored — the missing-file path.
 */
const setupWorkspace = ({ name = 'grill-me', content }: { name?: string; content?: string } = {}) => {
	const cwd = mkdtempSync(join(tmpdir(), 'lightsout-decisions-'));
	const decisionsPath = join(cwd, '.lightsout', 'plans', name, 'decisions.json');

	if (content !== undefined) {
		mkdirSync(join(cwd, '.lightsout', 'plans', name), { recursive: true });
		writeFileSync(decisionsPath, content);
	}

	return { cwd, name, decisionsPath };
};

/** One authored Decision-Log row, as the session writes it. */
const decisionRow = {
	source: 'Elicitation',
	question: 'where do plan deliverables live?',
	options: 'repo root / .claude/plans',
	choice: '.claude/plans',
	rationale: 'the committed, human-reviewed path implement reads',
	assumption: false,
};

describe('readDecisions', () => {
	test('returns the authored record parsed against the contract', async () => {
		const { cwd, name } = setupWorkspace({ content: JSON.stringify({ planName: 'grill-me', decisions: [decisionRow] }) });

		const record = await readDecisions({ cwd, name });

		expect(record).toStrictEqual({ planName: 'grill-me', decisions: [decisionRow] });
	});

	test('defaults an omitted decisions array to empty rather than failing the read', async () => {
		const { cwd, name } = setupWorkspace({ content: JSON.stringify({ planName: 'grill-me' }) });

		const record = await readDecisions({ cwd, name });

		// a record with no rows yet is authored, not corrupt
		expect(record).toStrictEqual({ planName: 'grill-me', decisions: [] });
	});

	test('reads from the plan workspace keyed by name, so two plans never cross', async () => {
		const { cwd } = setupWorkspace({ name: 'plan-a', content: JSON.stringify({ planName: 'plan-a', decisions: [] }) });

		mkdirSync(join(cwd, '.lightsout', 'plans', 'plan-b'), { recursive: true });
		writeFileSync(join(cwd, '.lightsout', 'plans', 'plan-b', 'decisions.json'), JSON.stringify({ planName: 'plan-b', decisions: [decisionRow] }));

		const record = await readDecisions({ cwd, name: 'plan-b' });

		// the name selects the workspace, not the first one on disk
		expect(record).toStrictEqual({ planName: 'plan-b', decisions: [decisionRow] });
	});

	test('rejects a missing decisions.json, naming the plan and the path to author', async () => {
		const { cwd, name, decisionsPath } = setupWorkspace({ name: 'unauthored' });

		const error = await getRejectionError({ promise: readDecisions({ cwd, name }) });

		expect(error.message).toMatch(/no decisions found for plan unauthored/);
		// the message names the workspace path the session must author
		expect(error.message).toContain(decisionsPath);
		expect(error.message).toMatch(/author decisions\.json before drafting/);
	});

	test('rejects a decisions.json that is not valid JSON', async () => {
		const { cwd, name } = setupWorkspace({ content: '{"planName": "grill-me",' });

		// a truncated file is a hard error — never a silent empty record
		expect(readDecisions({ cwd, name })).rejects.toThrow(SyntaxError);
	});

	test('rejects a record that violates the contract', async () => {
		const { cwd, name } = setupWorkspace({ content: JSON.stringify({ decisions: [decisionRow] }) });

		const error = await getRejectionError({ promise: readDecisions({ cwd, name }) });

		// the file was read — it is the shape that failed
		expect(error.message).not.toMatch(/no decisions found/);
		// the schema failure names the offending field
		expect(error.message).toMatch(/planName/);
	});

	test('rejects a decisions row missing a contract field', async () => {
		const { cwd, name } = setupWorkspace({
			content: JSON.stringify({ planName: 'grill-me', decisions: [{ source: 'Elicitation', question: 'q' }] }),
		});

		const error = await getRejectionError({ promise: readDecisions({ cwd, name }) });

		// a half-authored row fails the read rather than drafting from it
		expect(error.message).toMatch(/choice|options|rationale/);
	});
});
