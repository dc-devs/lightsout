import type { DriverCapabilities } from '#src/drivers/common/types/DriverCapabilities.ts';

interface Params {
	name: string;
}

/**
 * Capability registry — the second harness-level fact, beside `getDriver`'s
 * driver instances. Every name `getDriver` accepts resolves here too, and an
 * unknown name is a hard error rather than a permissive default: a harness
 * credited with a control it lacks costs the user a spawn in an environment
 * they did not get.
 *
 * A control is declared `true` only where the flag expressing it was checked
 * against an installed binary:
 *
 * - `claude-code` — all four, from three flags. `--strict-mcp-config` with no
 *   `--mcp-config`, `--disable-slash-commands`, and `--tools` with a named
 *   allowlist, all three accepted alongside `--permission-mode` and
 *   `--allowedTools`, leaving subscription auth, the permission mode and the
 *   repository's CLAUDE.md intact. Verified against claude CLI 2.1.270.
 * - `omp` — the skill and tool controls only: `--no-skills` and `--tools` are
 *   published and neither touches auth, model, effort or the approval mode,
 *   while the binary publishes no MCP flag at all. Verified against omp 18.1.6.
 * - `pi` — the tool control only: `--tools` is published (and already used here
 *   for the read-only toolbox), while no skill or MCP flag is. Verified against
 *   @earendil-works/pi-coding-agent 0.84.4.
 * - `codex` — nothing. No isolation flag on `codex exec` has been verified, so
 *   every control it cannot be observed to have is declared absent.
 */
export const getDriverCapabilities = ({ name }: Params): DriverCapabilities => {
	if (name === 'claude-code') {
		return { name, noMcpServers: true, noSkillCatalog: true, toolAllowlist: true, settingsPreserved: true };
	}

	if (name === 'codex') {
		return { name, noMcpServers: false, noSkillCatalog: false, toolAllowlist: false, settingsPreserved: false };
	}

	if (name === 'omp') {
		return { name, noMcpServers: false, noSkillCatalog: true, toolAllowlist: true, settingsPreserved: true };
	}

	if (name === 'pi') {
		return { name, noMcpServers: false, noSkillCatalog: false, toolAllowlist: true, settingsPreserved: true };
	}

	throw new Error(`unknown driver: ${name} (available: claude-code, codex, omp, pi)`);
};
