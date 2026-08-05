import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, test } from 'node:test';
import { readDecisions } from '@/plan';

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

		assert.deepEqual(record, { planName: 'grill-me', decisions: [decisionRow] });
	});

	test('defaults an omitted decisions array to empty rather than failing the read', async () => {
		const { cwd, name } = setupWorkspace({ content: JSON.stringify({ planName: 'grill-me' }) });

		const record = await readDecisions({ cwd, name });

		assert.deepEqual(record, { planName: 'grill-me', decisions: [] }, 'a record with no rows yet is authored, not corrupt');
	});

	test('reads from the plan workspace keyed by name, so two plans never cross', async () => {
		const { cwd } = setupWorkspace({ name: 'plan-a', content: JSON.stringify({ planName: 'plan-a', decisions: [] }) });

		mkdirSync(join(cwd, '.lightsout', 'plans', 'plan-b'), { recursive: true });
		writeFileSync(join(cwd, '.lightsout', 'plans', 'plan-b', 'decisions.json'), JSON.stringify({ planName: 'plan-b', decisions: [decisionRow] }));

		const record = await readDecisions({ cwd, name: 'plan-b' });

		assert.deepEqual(record, { planName: 'plan-b', decisions: [decisionRow] }, 'the name selects the workspace, not the first one on disk');
	});

	test('rejects a missing decisions.json, naming the plan and the path to author', async () => {
		const { cwd, name, decisionsPath } = setupWorkspace({ name: 'unauthored' });

		await assert.rejects(readDecisions({ cwd, name }), (error: unknown) => {
			assert.ok(error instanceof Error);
			assert.match(error.message, /no decisions found for plan unauthored/);
			assert.ok(error.message.includes(decisionsPath), `the message names the workspace path the session must author, got: ${error.message}`);
			assert.match(error.message, /author decisions\.json before drafting/);

			return true;
		});
	});

	test('rejects a decisions.json that is not valid JSON', async () => {
		const { cwd, name } = setupWorkspace({ content: '{"planName": "grill-me",' });

		await assert.rejects(readDecisions({ cwd, name }), SyntaxError, 'a truncated file is a hard error — never a silent empty record');
	});

	test('rejects a record that violates the contract', async () => {
		const { cwd, name } = setupWorkspace({ content: JSON.stringify({ decisions: [decisionRow] }) });

		await assert.rejects(readDecisions({ cwd, name }), (error: unknown) => {
			assert.ok(error instanceof Error);
			assert.doesNotMatch(error.message, /no decisions found/, 'the file was read — it is the shape that failed');
			assert.match(error.message, /planName/, 'the schema failure names the offending field');

			return true;
		});
	});

	test('rejects a decisions row missing a contract field', async () => {
		const { cwd, name } = setupWorkspace({
			content: JSON.stringify({ planName: 'grill-me', decisions: [{ source: 'Elicitation', question: 'q' }] }),
		});

		await assert.rejects(readDecisions({ cwd, name }), (error: unknown) => {
			assert.ok(error instanceof Error);
			assert.match(error.message, /choice|options|rationale/, 'a half-authored row fails the read rather than drafting from it');

			return true;
		});
	});
});
