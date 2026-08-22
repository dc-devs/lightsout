import { getRequiredFlag } from '#src/cli/common/args/getRequiredFlag.ts';
import { printStructuralFinding } from '#src/cli/common/render/printStructuralFinding.ts';
import { bold } from '#src/cli/common/terminal/bold.ts';
import { green } from '#src/cli/common/terminal/green.ts';
import { red } from '#src/cli/common/terminal/red.ts';
import type { CommandContext } from '#src/cli/common/types/CommandContext.ts';
import { createProgressPrinter } from '#src/cli/common/utils/createProgressPrinter.ts';
import { exitCli } from '#src/cli/common/utils/exitCli.ts';
import { getBlockingFindings, PlanRunStatus, runPlanLint } from '#src/plan/index.ts';

export const planLintCommand = async ({ flags, cwd }: CommandContext): Promise<void> => {
	const name = await getRequiredFlag({ flags, name: 'name' });
	const result = await runPlanLint({ cwd, name, onProgress: createProgressPrinter() });

	if (result.status === PlanRunStatus.Failed) {
		console.error(`\n${result.error}`);
		return exitCli({ code: 1 });
	}

	const { findings, planPaths } = result;
	const blocking = getBlockingFindings({ findings });
	const advisory = findings.length - blocking.length;
	const headline = blocking.length === 0 ? green('clean') : red(`${blocking.length} blocking finding(s)`);
	const note = advisory === 0 ? '' : `, ${advisory} advisory finding(s)`;

	console.log(`\n${bold(`plan lint ${name}`)} — ${headline}${note} (${planPaths.length} file(s))`);

	for (const finding of findings) {
		printStructuralFinding({ finding });
	}

	// Every finding prints, advisories included; the exit code is the signal the
	// writer's self-lint loop and humans both read, and only a blocking finding
	// moves it.
	return exitCli({ code: blocking.length > 0 ? 1 : 0 });
};
