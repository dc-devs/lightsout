import { expect, test } from '@jest/globals';
import { Permissions } from '#src/contracts/Permissions.ts';
import { buildClaudeCodeArgs } from '#src/drivers/buildClaudeCodeArgs.ts';
import type { AgentEnvironment } from '#src/drivers/common/types/AgentEnvironment.ts';

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

test('buildClaudeCodeArgs: a focused environment emits the three isolation flags before the grant flag', () => {
	const environment: AgentEnvironment = {
		noMcpServers: true,
		noSkillCatalog: true,
		toolAllowlist: true,
		settingsPreserved: true,
		tools: ['Read', 'Grep', 'Edit'],
	};

	const args = buildClaudeCodeArgs({ permissions: Permissions.Write, allowedCommands: ['pnpm'], environment });

	expect(args.slice(-8)).toStrictEqual([
		'--permission-mode',
		'acceptEdits',
		'--strict-mcp-config',
		'--disable-slash-commands',
		'--tools',
		'Read,Grep,Edit',
		'--allowedTools',
		'Bash(pnpm:*)',
	]);
});

test('buildClaudeCodeArgs: an environment requiring no control emits no isolation flag', () => {
	const environment: AgentEnvironment = {
		noMcpServers: false,
		noSkillCatalog: false,
		toolAllowlist: false,
		settingsPreserved: false,
		tools: [],
	};

	const args = buildClaudeCodeArgs({ environment });

	expect(args).toStrictEqual(['-p', '--output-format', 'stream-json', '--verbose', '--exclude-dynamic-system-prompt-sections']);
});

test('buildClaudeCodeArgs: isolation never rides a wholesale minimal mode', () => {
	const environment: AgentEnvironment = {
		noMcpServers: true,
		noSkillCatalog: true,
		toolAllowlist: true,
		settingsPreserved: true,
		tools: ['Read'],
	};

	const args = buildClaudeCodeArgs({ permissions: Permissions.FullAccess, environment });

	expect(args).not.toContain('--bare');
	expect(args).not.toContain('--restricted');
	expect(args).not.toContain('--safe-mode');
	expect(args).toContain('--strict-mcp-config');
	expect(args).toContain('--disable-slash-commands');
	expect(args.slice(args.indexOf('--permission-mode'), args.indexOf('--permission-mode') + 2)).toStrictEqual(['--permission-mode', 'bypassPermissions']);
});

test('buildClaudeCodeArgs: a focused environment emits no flag that drops repository instructions, permissions or authentication', () => {
	const environment: AgentEnvironment = {
		noMcpServers: true,
		noSkillCatalog: true,
		toolAllowlist: true,
		settingsPreserved: true,
		tools: ['Read', 'Write'],
	};

	const args = buildClaudeCodeArgs({ systemPromptPath: '/tmp/role.md', model: 'opus', effort: 'high', permissions: Permissions.Write, environment });

	expect(args.filter((arg) => ['--setting-sources', '--bare', '--restricted', '--safe-mode'].includes(arg))).toStrictEqual([]);
	expect(args.slice(-3)).toStrictEqual(['--disable-slash-commands', '--tools', 'Read,Write']);
});

test('buildClaudeCodeArgs: each control is emitted on its own, and a tool list is ignored unless the allowlist is required', () => {
	const environment: AgentEnvironment = {
		noMcpServers: false,
		noSkillCatalog: true,
		toolAllowlist: false,
		settingsPreserved: true,
		tools: ['Read', 'Grep'],
	};

	const args = buildClaudeCodeArgs({ permissions: Permissions.Write, environment });

	// A builder that emitted the bundle whenever any control was set, rather
	// than one flag per control, emits the other two here as well.
	expect(args).toStrictEqual([
		'-p',
		'--output-format',
		'stream-json',
		'--verbose',
		'--exclude-dynamic-system-prompt-sections',
		'--permission-mode',
		'acceptEdits',
		'--disable-slash-commands',
	]);
});
