import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test, type TestContext } from 'node:test';
import { FrictionArea, type FrictionRecord } from '@/contracts';
import { frictionCommand } from '@/cli/frictionCommand';
import { captureCommandOutput } from '@tests/helpers/captureCommandOutput';

// friction renders whatever the run state left on disk, so the arrangement is a
// real .lightsout/friction.jsonl in a temp repo — read back through the same
// reader the CLI uses, never stubbed.
const setupFriction = ({ t, entries, raw }: { t: TestContext; entries?: FrictionRecord[]; raw?: string }) => {
	const captured = captureCommandOutput({ t });
	const cwd = mkdtempSync(join(tmpdir(), 'lightsout-friction-command-'));
	const content = raw ?? (entries ? `${entries.map((entry) => JSON.stringify(entry)).join('\n')}\n` : undefined);

	if (content !== undefined) {
		mkdirSync(join(cwd, '.lightsout'), { recursive: true });
		writeFileSync(join(cwd, '.lightsout', 'friction.jsonl'), content);
	}

	return { context: { flags: new Map<string, string | true>(), rest: [], cwd }, ...captured };
};

test('frictionCommand: a repo with no friction log reports nothing recorded and exits 0', async (t) => {
	const { context, logged, errors, exitCodes } = setupFriction({ t });

	await assert.rejects(frictionCommand(context), /process\.exit/);

	assert.deepEqual(logged, ['no friction recorded']);
	assert.deepEqual(errors, []);
	assert.deepEqual(exitCodes, [0]);
});

test('frictionCommand: every recorded entry prints its area, short run id, step, timestamp and detail, then exits 0', async (t) => {
	const { context, logged, errors, exitCodes } = setupFriction({
		t,
		entries: [
			{ at: '2026-01-01T00:00:01.000Z', runId: 'run-1234-abcd', step: 'implement', area: FrictionArea.Plan, detail: 'ambiguous scope' },
			{ at: '2026-01-01T00:00:02.000Z', runId: 'another-run-9999', step: 'write-tests', area: FrictionArea.Environment, detail: 'no jest config' },
		],
	});

	await assert.rejects(frictionCommand(context), /process\.exit/);

	assert.deepEqual(logged, [
		'[plan] (run run-1234, implement, 2026-01-01T00:00:01.000Z) ambiguous scope',
		'[environment] (run another-, write-tests, 2026-01-01T00:00:02.000Z) no jest config',
	]);
	assert.deepEqual(errors, []);
	assert.deepEqual(exitCodes, [0]);
});

test('frictionCommand: a log holding only malformed lines reads as no friction — bad lines are skipped, never guessed at', async (t) => {
	const { context, logged, exitCodes } = setupFriction({ t, raw: '{"area":"plan"}\nnot json at all\n' });

	await assert.rejects(frictionCommand(context), /process\.exit/);

	assert.deepEqual(logged, ['no friction recorded']);
	assert.deepEqual(exitCodes, [0]);
});
