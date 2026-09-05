import { getStringFlag } from '#src/cli/common/args/getStringFlag.ts';
import { usage } from '#src/cli/common/constants/usage.ts';
import { bold } from '#src/cli/common/terminal/bold.ts';
import { yellow } from '#src/cli/common/terminal/yellow.ts';
import type { CommandContext } from '#src/cli/common/types/CommandContext.ts';
import { createProgressPrinter } from '#src/cli/common/utils/createProgressPrinter.ts';
import { ensureBrainstormFiles } from '#src/cli/common/utils/ensureBrainstormFiles.ts';
import { exitCli } from '#src/cli/common/utils/exitCli.ts';
import { PlanRunStatus, runPlanVerifyFacts } from '#src/plan/index.ts';

export const planVerifyFactsCommand = async ({ flags, cwd }: CommandContext): Promise<void> => {
	const name = getStringFlag({ flags, name: 'name' });

	if (!name) {
		console.error(usage);
		return exitCli({ code: 1 });
	}

	// The fetch has to have happened before anything asks the disk what the plan
	// folder holds — the same placement `implementCommand` gives
	// `ensurePlanWorkspace` at its own edge. A `brainstorm-notes.md` landed here
	// is already home, so the write-once `--notes` snapshot below keeps it.
	await ensureBrainstormFiles({ cwd, name });

	const notesFile = getStringFlag({ flags, name: 'notes' });
	const result = await runPlanVerifyFacts({ cwd, name, notesFile, onProgress: createProgressPrinter() });

	if (result.status === PlanRunStatus.Failed || !result.facts) {
		console.error(`\n${result.error ?? 'plan verify-facts failed'}`);
		return exitCli({ code: 1 });
	}

	const { verification } = result.facts;

	console.log(`\n${bold(`plan verify-facts ${name}`)} — ${result.facts.areas.length} area(s), verified ${result.facts.verifiedAt}`);
	console.log(`  paths:   ${verification.pathsChecked} checked · ${verification.missingPaths.length} missing`);
	console.log(`  scripts: ${verification.scriptsChecked} checked · ${verification.missingScripts.length} missing`);

	for (const missing of verification.missingPaths) {
		console.log(`${yellow('⚠')} path not found: ${missing}`);
	}

	for (const missing of verification.missingScripts) {
		console.log(`${yellow('⚠')} script not found: ${missing}`);
	}

	console.log(`\nfacts: ${result.factsPath}`);
	return exitCli({ code: 0 });
};
