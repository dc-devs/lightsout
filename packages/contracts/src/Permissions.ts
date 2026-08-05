/**
 * The harness-neutral capability vocabulary each driver translates into its own
 * flags. A value here is a statement of INTENT that each driver maps onto its
 * harness's nearest mechanism — never a guarantee of identical enforcement:
 * Claude Code enforces the granted command list at the tool level, while
 * Codex's workspace-write sandbox already permits commands, so the grant list
 * the engine injects into the prompt is what binds there.
 *
 * Three levels exist at the driver boundary; only `write` and `full-access` are
 * settable in config (enforced by `LightsoutConfig`), because `read-only` is
 * engine-selected for the read-only supervisor and is never a sane choice for a
 * writing role.
 */
export const Permissions = {
	ReadOnly: 'read-only',
	Write: 'write',
	FullAccess: 'full-access',
} as const;

export type Permissions = (typeof Permissions)[keyof typeof Permissions];
