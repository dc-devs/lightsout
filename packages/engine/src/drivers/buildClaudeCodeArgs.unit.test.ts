import { expect, test } from '@jest/globals';
import { Permissions } from '@/contracts';
import { buildClaudeCodeArgs } from '@/drivers';

test('buildClaudeCodeArgs: with no options the argv is exactly the base flags', () => {
	expect(buildClaudeCodeArgs({})).toStrictEqual(['-p', '--output-format', 'stream-json', '--verbose', '--exclude-dynamic-system-prompt-sections']);
});

test('buildClaudeCodeArgs: each neutral permission level maps to its Claude permission mode', () => {
	const modeFor = (permissions: Permissions) => {
		const args = buildClaudeCodeArgs({ permissions });

		return args[args.indexOf('--permission-mode') + 1];
	};

	expect(modeFor(Permissions.ReadOnly)).toBe('plan');
	expect(modeFor(Permissions.Write)).toBe('acceptEdits');
	expect(modeFor(Permissions.FullAccess)).toBe('bypassPermissions');
});

test('buildClaudeCodeArgs: effort passes the level verbatim, alongside the model when both are set', () => {
	const args = buildClaudeCodeArgs({ model: 'opus', effort: 'xhigh' });

	expect(args.slice(-4)).toStrictEqual(['--model', 'opus', '--effort', 'xhigh']);
});

test('buildClaudeCodeArgs: allowedCommands becomes one Bash prefix rule per grant after a single --allowedTools', () => {
	const args = buildClaudeCodeArgs({ allowedCommands: ['pnpm', 'npx prisma'] });

	expect(args.slice(-3)).toStrictEqual(['--allowedTools', 'Bash(pnpm:*)', 'Bash(npx prisma:*)']);
	expect(args.filter((arg) => arg === '--allowedTools').length).toBe(1);
});

test('buildClaudeCodeArgs: an empty grant list emits no --allowedTools flag', () => {
	const args = buildClaudeCodeArgs({ allowedCommands: [] });

	expect(args).toStrictEqual(['-p', '--output-format', 'stream-json', '--verbose', '--exclude-dynamic-system-prompt-sections']);
});

test('buildClaudeCodeArgs: a system prompt path rides the file flag, not the argv one', () => {
	const args = buildClaudeCodeArgs({ systemPromptPath: '/tmp/role.md' });

	expect(args.slice(-2)).toStrictEqual(['--append-system-prompt-file', '/tmp/role.md']);
});
