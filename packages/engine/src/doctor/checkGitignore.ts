import { runCommand } from '#src/common/processes/runCommand.ts';
import { probeTimeoutMs } from '#src/doctor/internal/common/constants/probeTimeoutMs.ts';
import type { DoctorCheck } from '#src/doctor/internal/common/types/DoctorCheck.ts';

interface Params {
	cwd: string;
}

/**
 * Ask git what it actually ignores instead of parsing .gitignore ourselves —
 * `.lightsout` (no slash), `.lightsout/`, and a dozen other spellings are all
 * valid; line-matching false-warned on a real consumer.
 *
 * One entry is probed rather than a folder-by-folder list, because nothing
 * under the state directory is meant to be tracked. A list names a layout, and
 * a layout is what drifts out of step with the engine that writes it.
 */
export const checkGitignore = async ({ cwd }: Params): Promise<DoctorCheck> => {
	const stateDir = '.lightsout';
	// A path inside the folder rather than the folder itself, so a consumer who
	// wrote `.lightsout/` answers exactly as one who wrote `.lightsout`.
	const result = await runCommand({ command: `git check-ignore -q -- '${stateDir}/probe'`, cwd, timeoutMs: probeTimeoutMs }).catch(() => ({ exitCode: 128 }));
	const gitUsable = result.exitCode === 0 || result.exitCode === 1;

	return !gitUsable
		? { id: 'gitignore', status: 'warn', detail: 'not a git repository — .gitignore not evaluated' }
		: result.exitCode === 0
			? { id: 'gitignore', status: 'pass', detail: 'the lightsout state directory is ignored (verified via git check-ignore)' }
			: {
					id: 'gitignore',
					status: 'warn',
					detail: `run state not ignored: ${stateDir}`,
					fix: `add to .gitignore:\n${stateDir}`,
				};
};
