import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Permissions } from '@lightsout/contracts';
import { buildCodexArgs } from './buildCodexArgs';

const outFile = '/tmp/last-message.txt';

test('buildCodexArgs: write — and an absent permissions — yield the workspace-write sandbox plus the pinned approval policy', () => {
	const explicit = buildCodexArgs({ outFile, permissions: Permissions.Write });
	const absent = buildCodexArgs({ outFile });

	assert.deepEqual(explicit, ['exec', '--skip-git-repo-check', '--color', 'never', '--output-last-message', outFile, '--sandbox', 'workspace-write', '-c', 'approval_policy="never"']);
	assert.deepEqual(absent, explicit, 'an absent value keeps the workspace-write default');
});

test('buildCodexArgs: read-only yields the read-only sandbox with the same approval pin', () => {
	const args = buildCodexArgs({ outFile, permissions: Permissions.ReadOnly });

	assert.deepEqual(args.slice(-4), ['--sandbox', 'read-only', '-c', 'approval_policy="never"']);
});

test('buildCodexArgs: full-access is the bundled flag alone — it owns both the approval and sandbox axes', () => {
	const args = buildCodexArgs({ outFile, permissions: Permissions.FullAccess });

	assert.ok(args.includes('--dangerously-bypass-approvals-and-sandbox'));
	assert.ok(!args.includes('--sandbox'), 'no separate sandbox flag');
	assert.ok(!args.some((arg) => arg.startsWith('approval_policy')), 'no separate approval override');
});

test('buildCodexArgs: effort rides a config override as two argv entries', () => {
	const args = buildCodexArgs({ outFile, effort: 'high' });

	assert.deepEqual(args.slice(-2), ['-c', 'model_reasoning_effort="high"']);
});

test('buildCodexArgs: the model flag and the output file both land where codex expects them', () => {
	const args = buildCodexArgs({ outFile, model: 'gpt-5.2' });

	assert.equal(args[args.indexOf('--output-last-message') + 1], outFile);
	assert.equal(args[args.indexOf('--model') + 1], 'gpt-5.2');
});
