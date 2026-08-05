import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Permissions } from '@lightsout/contracts';
import { buildClaudeCodeArgs } from './buildClaudeCodeArgs';

test('buildClaudeCodeArgs: with no options the argv is exactly the base flags', () => {
	assert.deepEqual(buildClaudeCodeArgs({}), ['-p', '--output-format', 'stream-json', '--verbose', '--exclude-dynamic-system-prompt-sections']);
});

test('buildClaudeCodeArgs: each neutral permission level maps to its Claude permission mode', () => {
	const modeFor = (permissions: Permissions) => {
		const args = buildClaudeCodeArgs({ permissions });

		return args[args.indexOf('--permission-mode') + 1];
	};

	assert.equal(modeFor(Permissions.ReadOnly), 'plan');
	assert.equal(modeFor(Permissions.Write), 'acceptEdits');
	assert.equal(modeFor(Permissions.FullAccess), 'bypassPermissions');
});

test('buildClaudeCodeArgs: effort passes the level verbatim, alongside the model when both are set', () => {
	const args = buildClaudeCodeArgs({ model: 'opus', effort: 'xhigh' });

	assert.deepEqual(args.slice(-4), ['--model', 'opus', '--effort', 'xhigh']);
});

test('buildClaudeCodeArgs: allowedCommands becomes one Bash prefix rule per grant after a single --allowedTools', () => {
	const args = buildClaudeCodeArgs({ allowedCommands: ['pnpm', 'npx prisma'] });

	assert.deepEqual(args.slice(-3), ['--allowedTools', 'Bash(pnpm:*)', 'Bash(npx prisma:*)']);
	assert.equal(args.filter((arg) => arg === '--allowedTools').length, 1);
});

test('buildClaudeCodeArgs: an empty grant list emits no --allowedTools flag', () => {
	const args = buildClaudeCodeArgs({ allowedCommands: [] });

	assert.deepEqual(args, ['-p', '--output-format', 'stream-json', '--verbose', '--exclude-dynamic-system-prompt-sections']);
});

test('buildClaudeCodeArgs: a system prompt path rides the file flag, not the argv one', () => {
	const args = buildClaudeCodeArgs({ systemPromptPath: '/tmp/role.md' });

	assert.deepEqual(args.slice(-2), ['--append-system-prompt-file', '/tmp/role.md']);
});
