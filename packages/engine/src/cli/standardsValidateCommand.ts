import { resolve } from 'node:path';
import { getStringFlag } from '#src/cli/common/args/getStringFlag.ts';
import { dim } from '#src/cli/common/terminal/dim.ts';
import { green } from '#src/cli/common/terminal/green.ts';
import { red } from '#src/cli/common/terminal/red.ts';
import type { CommandContext } from '#src/cli/common/types/CommandContext.ts';
import { exitCli } from '#src/cli/common/utils/exitCli.ts';
import { messageOf } from '#src/common/utils/messageOf.ts';
import { validateStandardsPack } from '#src/standardsCheck/index.ts';
import { readStandardsPack, resolveDefaultStandardsPack } from '#src/standardsPacks/index.ts';

/**
 * The pack named by `--pack`, or the bundled default when the flag is absent.
 * Async so that a default that cannot be located rejects like a pack that
 * cannot be read — one failure path for the caller to report.
 */
const readRequestedPack = async ({ requested, cwd }: { requested?: string; cwd: string }) =>
	// resolve() leaves an absolute --pack alone, so both forms the flag accepts
	// land here.
	readStandardsPack({ packPath: requested === undefined ? resolveDefaultStandardsPack() : resolve(cwd, requested) });

/**
 * `lightsout standards-validate` — run every check in a standards pack against
 * its own fixtures.
 *
 * The authoring gate: a rule whose fail fixture goes unflagged is a check that
 * catches nothing, and one whose pass fixture is flagged is a check that cries
 * wolf. Neither is visible at load time, and both are exactly what someone
 * writing a rule needs told.
 */
export const standardsValidateCommand = async ({ flags, cwd }: CommandContext): Promise<void> => {
	const requested = getStringFlag({ flags, name: 'pack' });
	const pack = await readRequestedPack({ requested, cwd }).catch((error: unknown) => {
		console.error(messageOf({ error }));
		return exitCli({ code: 1 });
	});
	const { problems, notes } = await validateStandardsPack({ pack });

	for (const note of notes) {
		console.log(`${dim('ℹ')} ${dim(note)}`);
	}

	for (const problem of problems) {
		console.log(`${red('✗')} ${problem}`);
	}

	const checked = pack.rules.filter((rule) => rule.checked).length;
	const judgment = pack.rules.length - checked;

	console.log('');

	if (problems.length > 0) {
		console.log(`${pack.name} — ${problems.length} problem(s) across ${checked} checked rule(s)`);
		return exitCli({ code: 1 });
	}

	console.log(green(`${pack.name} — ${checked} checked rule(s) validated, ${judgment} judgment-only rule(s)`));
	return exitCli({ code: 0 });
};
