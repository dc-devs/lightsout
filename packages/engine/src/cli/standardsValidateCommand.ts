import { resolve } from 'node:path';
import { getStringFlag } from '@/cli/common/args/getStringFlag';
import { dim } from '@/cli/common/terminal/dim';
import { green } from '@/cli/common/terminal/green';
import { red } from '@/cli/common/terminal/red';
import type { CommandContext } from '@/cli/common/types/CommandContext';
import { exitCli } from '@/cli/common/utils/exitCli';
import { messageOf } from '@/common/utils/messageOf';
import { validateStandardsPackage } from '@/standardsCheck';
import { loadStandardsPackage, resolveDefaultStandardsPackage } from '@/standardsPackages';

/**
 * The package named by `--package`, or the bundled default when the flag is
 * absent. Async so that a default that cannot be located rejects like a package
 * that cannot be read — one failure path for the caller to report.
 */
const loadRequestedPackage = async ({ requested, cwd }: { requested?: string; cwd: string }) =>
	// resolve() leaves an absolute --package alone, so both forms the flag
	// accepts land here.
	loadStandardsPackage({ packagePath: requested === undefined ? resolveDefaultStandardsPackage() : resolve(cwd, requested) });

/**
 * `lightsout standards-validate` — run every check in a standards package
 * against its own fixtures.
 *
 * The authoring gate: a rule whose fail fixture goes unflagged is a check that
 * catches nothing, and one whose pass fixture is flagged is a check that cries
 * wolf. Neither is visible at load time, and both are exactly what someone
 * writing a rule needs told.
 */
export const standardsValidateCommand = async ({ flags, cwd }: CommandContext): Promise<void> => {
	const requested = getStringFlag({ flags, name: 'package' });
	const pkg = await loadRequestedPackage({ requested, cwd }).catch((error: unknown) => {
		console.error(messageOf({ error }));
		return exitCli({ code: 1 });
	});
	const { problems, notes } = await validateStandardsPackage({ pkg });

	for (const note of notes) {
		console.log(`${dim('ℹ')} ${dim(note)}`);
	}

	for (const problem of problems) {
		console.log(`${red('✗')} ${problem}`);
	}

	const checked = pkg.rules.filter((rule) => rule.checked).length;
	const judgment = pkg.rules.length - checked;

	console.log('');

	if (problems.length > 0) {
		console.log(`${pkg.name} — ${problems.length} problem(s) across ${checked} checked rule(s)`);
		return exitCli({ code: 1 });
	}

	console.log(green(`${pkg.name} — ${checked} checked rule(s) validated, ${judgment} judgment-only rule(s)`));
	return exitCli({ code: 0 });
};
