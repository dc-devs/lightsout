import { type Effort, Permissions } from '#src/contracts/index.ts';

/** Which pi-family binary the argv targets — omp adds the approval-mode surface pi lacks. */
export type PiVariant = 'pi' | 'omp';

/**
 * The inspection toolset each binary ships, as the read-only toolbox: enabling
 * exactly these tools disables `bash`, `edit`, and `write` outright. The names
 * differ between the binaries — omp renamed pi's `find` to `glob` and added
 * `lsp` — so each variant names its own list.
 */
const readOnlyTools: Record<PiVariant, string> = {
	pi: 'read,grep,find,ls',
	omp: 'read,grep,glob,lsp',
};

interface Params {
	variant: PiVariant;
	systemPromptPath?: string;
	model?: string;
	effort?: Effort;
	permissions?: Permissions;
}

/**
 * Assemble the argv for one `pi -p` / `omp -p` spawn. Kept pure and separate
 * from the driver so the permission translation and the thinking flag are
 * testable without spawning a process. Flag surface verified against
 * @earendil-works/pi-coding-agent 0.84.4 and omp 18.1.6.
 *
 * There is no granted-commands mapping here, on either variant. Bare pi has no
 * permission system to grant through at all. omp could carry per-prefix grants
 * in a `--config` overlay's `bash.patterns` allow rules, but an overlay
 * replaces that key wholesale — a user's own deny rules would silently vanish
 * for the spawned process, and a grant that can close what the user's settings
 * allow is not a grant this engine may make. The binding grant is the
 * prompt-level list the engine injects into the invocation, exactly as it
 * already is on codex.
 */
export const buildPiArgs = ({ variant, systemPromptPath, model, effort, permissions }: Params): string[] => {
	const args = ['-p', '--mode', 'json', '--no-session'];

	if (systemPromptPath) {
		// A path to an existing file makes the harness append the file's
		// contents — role + plan + standards can reach hundreds of kilobytes
		// against a fixed argv ceiling.
		args.push('--append-system-prompt', systemPromptPath);
	}

	if (model) {
		args.push('--model', model);
	}

	if (effort) {
		// The five shared levels are the harness's own thinking vocabulary
		// verbatim; the values only one harness honors (`off`, `minimal`,
		// `auto`) are deliberately not offered anywhere in the config.
		args.push('--thinking', effort);
	}

	if (permissions === Permissions.ReadOnly) {
		args.push('--tools', readOnlyTools[variant]);
	}

	// Bare pi has no permission system — upstream's stated stance — so write
	// and full-access have no flag to map there and the capability intent
	// rides the invocation prompt alone. omp's approval tiers are the nearest
	// mechanism: `write` auto-approves the read and write tiers and leaves
	// exec-tier calls rejected (a print run has no UI to answer a prompt),
	// `yolo` auto-approves everything. Passed explicitly even though omp
	// defaults to yolo, so a user's own settings cannot change what a
	// permissions value means here.
	if (variant === 'omp' && (permissions === Permissions.Write || permissions === Permissions.FullAccess)) {
		args.push('--approval-mode', permissions === Permissions.Write ? 'write' : 'yolo');
	}

	return args;
};
