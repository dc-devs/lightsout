import { usage } from '#src/cli/common/constants/usage.ts';
import { loadRunFamilyProgressBlock } from '#src/cli/common/progressBlock/loadRunFamilyProgressBlock.ts';
import { printAmbiguousRuns } from '#src/cli/common/runStatus/printAmbiguousRuns.ts';
import { printNewestRun } from '#src/cli/common/runStatus/printNewestRun.ts';
import { resolveWatchTarget } from '#src/cli/common/utils/resolveWatchTarget.ts';

interface Params {
	cwd: string;
	/** The flags the reader typed, so this form refuses its own contradictions. */
	flags: Map<string, string | true>;
}

/**
 * `status --now`: the run that is going, printed once.
 *
 * It answers at once. The minute-long grace `--watch` spends exists for a
 * caller that has just started a run in the background, and a person typing
 * this form has not — so the resolver is asked for no grace at all.
 *
 * A phased plan prints both of its levels: the phase sequence, then the phase
 * moving now. Nothing going falls back to the newest run of any status, and
 * several unrelated families going are named back rather than guessed at. The
 * block is appended after a blank line; nothing clears the screen and nothing
 * repaints.
 *
 * It owns its own refusal — `--now` beside `--run`, `--watch`, `--planning` or
 * `--shipping`, or carrying a value — so the dispatcher stays a router.
 *
 * @returns the exit code the command ends with: 1 for a refusal or an ambiguous answer, 0 otherwise
 */
export const printGoingRunStatus = async ({ cwd, flags }: Params): Promise<number> => {
	if (flags.get('now') !== true || flags.has('run') || flags.has('watch') || flags.has('planning') || flags.has('shipping')) {
		console.error(usage);
		return 1;
	}

	const going = await resolveWatchTarget({ cwd, graceMs: 0 });
	let code = 0;

	if (going !== undefined && 'ambiguous' in going) {
		printAmbiguousRuns({ roots: going.ambiguous });
		code = 1;
	} else if (going === undefined) {
		await printNewestRun({ cwd });
	} else {
		console.log('');

		// The family HEAD the resolver answered, not its root: the loader climbs,
		// and climbing is where the guard against an unreadable coordinator lives.
		for (const line of await loadRunFamilyProgressBlock({ cwd, runId: going.runId })) {
			console.log(line);
		}
	}

	return code;
};
