import { runPlanVerifyFacts } from '@/plan';
import { getStringFlag } from '@/cli/common/args/getStringFlag';
import { usage } from '@/cli/common/constants/usage';
import { bold } from '@/cli/common/terminal/bold';
import { yellow } from '@/cli/common/terminal/yellow';
import type { CommandContext } from '@/cli/common/types/CommandContext';
import { createProgressPrinter } from '@/cli/common/utils/createProgressPrinter';

export const planVerifyFactsCommand = async ({ flags, cwd }: CommandContext): Promise<void> => {
	const name = getStringFlag({ flags, name: 'name' });

	if (!name) {
		console.error(usage);
		process.exit(1);
	}

	const notesFile = getStringFlag({ flags, name: 'notes' });
	const result = await runPlanVerifyFacts({ cwd, name, notesFile, onProgress: createProgressPrinter() });

	if (result.status === 'failed' || !result.facts) {
		console.error(`\n${result.error ?? 'plan verify-facts failed'}`);
		process.exit(1);
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
	process.exit(0);
};
