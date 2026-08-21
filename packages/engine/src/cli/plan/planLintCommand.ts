import { getRequiredFlag } from '#src/cli/common/args/getRequiredFlag.ts';
import { printStructuralFinding } from '#src/cli/common/render/printStructuralFinding.ts';
import { bold } from '#src/cli/common/terminal/bold.ts';
import { green } from '#src/cli/common/terminal/green.ts';
import { red } from '#src/cli/common/terminal/red.ts';
import type { CommandContext } from '#src/cli/common/types/CommandContext.ts';
import { createProgressPrinter } from '#src/cli/common/utils/createProgressPrinter.ts';
import { exitCli } from '#src/cli/common/utils/exitCli.ts';
import { PlanRunStatus, runPlanLint } from '#src/plan/index.ts';

export const planLintCommand = async ({ flags, cwd }: CommandContext): Promise<void> => {
	const name = await getRequiredFlag({ flags, name: 'name' });
	const result = await runPlanLint({ cwd, name, onProgress: createProgressPrinter() });

	if (result.status === PlanRunStatus.Failed) {
		console.error(`\n${result.error}`);
		return exitCli({ code: 1 });
	}

	const { findings, planPaths } = result;

	console.log(
		`\n${bold(`plan lint ${name}`)} — ${findings.length === 0 ? green('clean') : red(`${findings.length} structural finding(s)`)} (${planPaths.length} file(s))`,
	);

	for (const finding of findings) {
		printStructuralFinding({ finding });
	}

	// Findings print either way; the exit code is the signal the writer's
	// self-lint loop and humans both read.
	return exitCli({ code: findings.length > 0 ? 1 : 0 });
};
