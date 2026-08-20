import { type Effort, Permissions } from '#src/contracts/index.ts';

interface Params {
	/** Temp file codex writes its final message to (`--output-last-message`). */
	outFile: string;
	model?: string;
	effort?: Effort;
	permissions?: Permissions;
}

/**
 * Assemble the argv for one `codex exec` spawn. Kept pure and separate from the
 * driver so the sandbox mapping, the pinned approval policy, and the effort
 * override are testable without spawning a process. Both config keys verified
 * present in codex-cli 0.146.0.
 */
export const buildCodexArgs = ({ outFile, model, effort, permissions }: Params): string[] => {
	const args = ['exec', '--skip-git-repo-check', '--color', 'never', '--output-last-message', outFile];

	if (permissions === Permissions.FullAccess) {
		// The bundled flag sets approval AND sandbox together; adding a separate
		// approval override alongside it would re-split the axis this driver
		// deliberately keeps off the config surface.
		args.push('--dangerously-bypass-approvals-and-sandbox');
	} else {
		args.push('--sandbox', permissions === Permissions.ReadOnly ? 'read-only' : 'workspace-write');
		// Approval only means anything when a human can answer, and `codex exec`
		// never prompts — pinning the policy here makes explicit what the harness
		// already does, and is what keeps it from becoming a setting. The value is
		// TOML parsed by codex itself; spawnCollect uses no shell, so the quotes
		// reach codex literally and parse as the TOML string `never`.
		args.push('-c', 'approval_policy="never"');
	}

	if (model) {
		args.push('--model', model);
	}

	if (effort) {
		args.push('-c', `model_reasoning_effort="${effort}"`);
	}

	return args;
};
