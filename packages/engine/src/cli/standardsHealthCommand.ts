import { printStandardsHealth } from '#src/cli/common/render/printStandardsHealth.ts';
import type { CommandContext } from '#src/cli/common/types/CommandContext.ts';
import { exitCli } from '#src/cli/common/utils/exitCli.ts';
import { loadConfig } from '#src/common/utils/loadConfig.ts';
import { buildStandardsHealth } from '#src/standardsCheck/index.ts';
import { resolveStandardsPackages } from '#src/standardsPackages/index.ts';

/**
 * `lightsout standards-health` — which rules are machine-checked, which are
 * judgment, and how often agents declined each one's findings.
 *
 * A repo with no config still has an answer (the package lightsout ships, every
 * rule at its default), and a repo with no refactor history still has half of
 * one: the coverage claim comes from the package's folders, so it never depends
 * on anything having been run.
 *
 * Informational — it always exits 0. It reports on the rules, not on the code,
 * so there is nothing here for a caller to gate on.
 */
export const standardsHealthCommand = async ({ cwd }: CommandContext): Promise<void> => {
	const config = await loadConfig({ cwd }).catch(() => undefined);
	const packages = await resolveStandardsPackages({ cwd, config });
	const health = await buildStandardsHealth({ cwd, packages });

	printStandardsHealth({ health });
	return exitCli({ code: 0 });
};
