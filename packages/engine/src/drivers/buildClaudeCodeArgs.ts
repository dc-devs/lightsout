import type { Effort } from '#src/contracts/Effort.ts';
import { Permissions } from '#src/contracts/Permissions.ts';
import type { AgentEnvironment } from '#src/drivers/common/types/AgentEnvironment.ts';

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
	environment?: AgentEnvironment;
}

/**
 * Assemble the argv for one `claude -p` spawn. Kept pure and separate from the
 * driver so the permission translation and the effort flag are testable without
 * spawning a process.
 *
 * The focused-environment mapping — `getDriverCapabilities` owns the record of
 * which controls each harness was verified to have, and against which binary
 * version. `noMcpServers` is `--strict-mcp-config` (no `--mcp-config` is passed
 * anywhere here, which is what makes it load zero servers rather than some
 * named file's), `noSkillCatalog` is `--disable-slash-commands`, `toolAllowlist`
 * is `--tools` with the names comma-joined into one argument, and
 * `settingsPreserved` needs no flag at all — it is satisfied by those three
 * being per-property flags, none of which touches auth, the model, the effort
 * level or the permission mode.
 *
 * `--setting-sources ""` is the obvious companion to the skill flag and is
 * deliberately NOT emitted: measured here, it takes the repository's own
 * CLAUDE.md out of the spawn. With the three flags the spawn quotes this
 * repository's CLAUDE.md verbatim; with the fourth added it answers that it has
 * no such instructions. It was not earning its place either — the current draft
 * environment boots at 20,943 tokens, the three flags bring it to 9,613, and
 * the fourth reaches 8,494, about 1,100 tokens for the repository instructions
 * a plan writer is ordered to follow.
 *
 * The wholesale modes in `claude --help` are all refused for the same reason.
 * `--bare` restricts auth to an API key and never reads OAuth or the keychain,
 * moving the user off the subscription this engine bills against — and drivers
 * never handle credentials. `--restricted` refuses `bypassPermissions`, which
 * is what `full-access` maps to here, so it would silently downgrade a
 * configured permission level. `--safe-mode` disables CLAUDE.md along with the
 * skills, plugins and MCP servers. Each is also a bundle whose contents the
 * harness may change between versions, whereas four named per-property flags
 * are what let a capability record say exactly what is expressed.
 */
export const buildClaudeCodeArgs = ({ systemPromptPath, model, effort, permissions, allowedCommands, environment }: Params): string[] => {
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

	if (environment?.noMcpServers) {
		args.push('--strict-mcp-config');
	}

	if (environment?.noSkillCatalog) {
		args.push('--disable-slash-commands');
	}

	if (environment?.toolAllowlist) {
		// One comma-joined argument, not one argument per name: --tools is
		// variadic, so a list spread across separate arguments would be
		// ambiguous wherever another flag follows.
		args.push('--tools', environment.tools.join(','));
	}

	// The grant flag stays last: it is variadic, so a flag emitted after it
	// would have to be told apart from a grant by the harness's own parser.
	if (allowedCommands && allowedCommands.length > 0) {
		// `Bash(<prefix>:*)` is the CLI's prefix-match permission rule;
		// --allowedTools is variadic, one rule per granted prefix. Additive
		// only — user settings that already allow more stay in charge.
		args.push('--allowedTools', ...allowedCommands.map((prefix) => `Bash(${prefix}:*)`));
	}

	return args;
};
