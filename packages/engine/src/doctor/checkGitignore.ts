import { runCommand } from '#src/common/processes/runCommand.ts';
import { probeTimeoutMs } from '#src/doctor/common/constants/probeTimeoutMs.ts';
import type { DoctorCheck } from '#src/doctor/common/types/DoctorCheck.ts';

const gitignoreEntries = ['.lightsout/runs/', '.lightsout/plans/', '.lightsout/friction.jsonl', '.lightsout/lock.json'];

interface Params {
	cwd: string;
}

/**
 * Ask git what it actually ignores instead of parsing .gitignore ourselves —
 * `.lightsout` (no slash), `.lightsout/`, and a dozen other spellings are all
 * valid; line-matching false-warned on a real consumer.
 */
export const checkGitignore = async ({ cwd }: Params): Promise<DoctorCheck> => {
	const notIgnored: string[] = [];
	let gitUsable = true;

	for (const entry of gitignoreEntries) {
		const probePath = entry.endsWith('/') ? `${entry}probe` : entry;
		const result = await runCommand({ command: `git check-ignore -q -- '${probePath}'`, cwd, timeoutMs: probeTimeoutMs }).catch(() => ({
			exitCode: 128,
		}));

		if (result.exitCode === 1) {
			notIgnored.push(entry);
		} else if (result.exitCode !== 0) {
			gitUsable = false;
		}
	}

	return !gitUsable
		? { id: 'gitignore', status: 'warn', detail: 'not a git repository — .gitignore not evaluated' }
		: notIgnored.length === 0
			? { id: 'gitignore', status: 'pass', detail: 'run state is ignored (verified via git check-ignore)' }
			: {
					id: 'gitignore',
					status: 'warn',
					detail: `run state not ignored: ${notIgnored.join(', ')}`,
					fix: `add to .gitignore:\n${notIgnored.join('\n')}`,
				};
};
