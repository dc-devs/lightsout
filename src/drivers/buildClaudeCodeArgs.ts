import { type Effort, Permissions } from '@/contracts';

/** The neutral capability levels expressed in Claude Code's own permission-mode vocabulary. */
const claudePermissionModes: Record<Permissions, string> = {
	[Permissions.ReadOnly]: 'plan',
	[Permissions.Write]: 'acceptEdits',
	[Permissions.FullAccess]: 'bypassPermissions',
};

interface Params {
	systemPromptPath?: string;
	model?: string;
	effort?: Effort;
	permissions?: Permissions;
	allowedCommands?: string[];
}

/**
 * Assemble the argv for one `claude -p` spawn. Kept pure and separate from the
 * driver so the permission translation and the effort flag are testable without
 * spawning a process.
 */
export const buildClaudeCodeArgs = ({ systemPromptPath, model, effort, permissions, allowedCommands }: Params): string[] => {
	// stream-json (which requires --verbose in print mode) instead of json:
	// same final result payload, but every intermediate event — tool calls,
	// token ticks — arrives live for transcripts and progress narration.
	// The dynamic sections (git status and friends) move to the first user
	// message, so the default system prompt stays byte-identical between
	// steps — the cached prefix the engine's system-prompt layout depends on.
	const args = ['-p', '--output-format', 'stream-json', '--verbose', '--exclude-dynamic-system-prompt-sections'];

	if (systemPromptPath) {
		// Append, never replace: keeps the harness's default agent behavior,
		// mirroring how the Agent tool layers a role prompt onto a subagent.
		// The file variant, not the argv one: role + plan + standards can reach
		// hundreds of kilobytes against a fixed argv ceiling.
		args.push('--append-system-prompt-file', systemPromptPath);
	}

	if (model) {
		args.push('--model', model);
	}

	if (effort) {
		args.push('--effort', effort);
	}

	if (permissions) {
		args.push('--permission-mode', claudePermissionModes[permissions]);
	}

	if (allowedCommands && allowedCommands.length > 0) {
		// `Bash(<prefix>:*)` is the CLI's prefix-match permission rule;
		// --allowedTools is variadic, one rule per granted prefix. Additive
		// only — user settings that already allow more stay in charge.
		args.push('--allowedTools', ...allowedCommands.map((prefix) => `Bash(${prefix}:*)`));
	}

	return args;
};
