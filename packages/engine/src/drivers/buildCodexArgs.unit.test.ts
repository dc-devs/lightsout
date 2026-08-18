import { expect, test } from '@jest/globals';
import { Permissions } from '@/contracts';
import { buildCodexArgs } from '@/drivers';

const outFile = '/tmp/last-message.txt';

test('buildCodexArgs: write — and an absent permissions — yield the workspace-write sandbox plus the pinned approval policy', () => {
	const explicit = buildCodexArgs({ outFile, permissions: Permissions.Write });
	const absent = buildCodexArgs({ outFile });

	expect(explicit).toStrictEqual([
		'exec',
		'--skip-git-repo-check',
		'--color',
		'never',
		'--output-last-message',
		outFile,
		'--sandbox',
		'workspace-write',
		'-c',
		'approval_policy="never"',
	]);
	// an absent value keeps the workspace-write default
	expect(absent).toStrictEqual(explicit);
});

test('buildCodexArgs: read-only yields the read-only sandbox with the same approval pin', () => {
	const args = buildCodexArgs({ outFile, permissions: Permissions.ReadOnly });

	expect(args.slice(-4)).toStrictEqual(['--sandbox', 'read-only', '-c', 'approval_policy="never"']);
});

test('buildCodexArgs: full-access is the bundled flag alone — it owns both the approval and sandbox axes', () => {
	const args = buildCodexArgs({ outFile, permissions: Permissions.FullAccess });

	expect(args.includes('--dangerously-bypass-approvals-and-sandbox')).toBeTruthy();
	// no separate sandbox flag
	expect(args.includes('--sandbox')).toBeFalsy();
	// no separate approval override
	expect(args.some((arg) => arg.startsWith('approval_policy'))).toBeFalsy();
});

test('buildCodexArgs: effort rides a config override as two argv entries', () => {
	const args = buildCodexArgs({ outFile, effort: 'high' });

	expect(args.slice(-2)).toStrictEqual(['-c', 'model_reasoning_effort="high"']);
});

test('buildCodexArgs: the model flag and the output file both land where codex expects them', () => {
	const args = buildCodexArgs({ outFile, model: 'gpt-5.2' });

	expect(args[args.indexOf('--output-last-message') + 1]).toBe(outFile);
	expect(args[args.indexOf('--model') + 1]).toBe('gpt-5.2');
});
