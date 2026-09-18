import { getStringFlag } from '#src/cli/common/args/getStringFlag.ts';
import { usage } from '#src/cli/common/constants/usage.ts';
import { bold } from '#src/cli/common/terminal/bold.ts';
import { yellow } from '#src/cli/common/terminal/yellow.ts';
import type { CommandContext } from '#src/cli/common/types/CommandContext.ts';
import { createProgressPrinter } from '#src/cli/common/utils/createProgressPrinter.ts';
import { ensureBrainstormFiles } from '#src/cli/common/utils/ensureBrainstormFiles.ts';
import { exitCli } from '#src/cli/common/utils/exitCli.ts';
import { PlanningStep, RunStatus } from '#src/contracts/index.ts';
import { PlanRunStatus, recordPlanCommandRun, recordPlanningStep, runPlanVerifyFacts } from '#src/plan/index.ts';

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
	// The same conditions that pick exit 1 and exit 0 below, and the one reading
	// both records state — a step this run failed must not read as passed in the
	// activity record.
	const statusOf = ({ result: verified }: { result: Awaited<ReturnType<typeof runPlanVerifyFacts>> }) =>
		verified.status === PlanRunStatus.Failed || !verified.facts ? RunStatus.Failed : RunStatus.Passed;
	// Wrapped outside the planning-step record and inside the refusals above, so
	// a command that refuses before doing any work opens no level at all. This
	// subcommand spawns no agent, so its command run carries no child: the
	// level's own time is the whole of what it records.
	const result = await recordPlanCommandRun({
		cwd,
		name,
		label: 'plan verify-facts',
		statusOf,
		work: () =>
			recordPlanningStep({
				cwd,
				name,
				step: PlanningStep.VerifyFacts,
				work: () => runPlanVerifyFacts({ cwd, name, notesFile, onProgress: createProgressPrinter() }),
				statusOf,
			}),
	});

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
