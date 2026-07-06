import { getDriver } from '@lightsout/drivers';
import { loadConfig, runPlanExplore } from '@lightsout/engine';
import { getPositionals } from '../common/args/getPositionals';
import { getStringFlag } from '../common/args/getStringFlag';
import { usage } from '../common/constants/usage';
import { bold } from '../common/terminal/bold';
import { yellow } from '../common/terminal/yellow';
import { createProgressPrinter } from '../common/utils/createProgressPrinter';
import type { CommandContext } from '../common/types/CommandContext';

export const planExploreCommand = async ({ flags, rest, cwd }: CommandContext): Promise<void> => {
	const name = getStringFlag({ flags, name: 'name' });
	const request = getPositionals({ args: rest }).slice(1).join(' ');
	const areasFlag = getStringFlag({ flags, name: 'areas' });
	const areas = areasFlag
		? areasFlag
				.split(',')
				.map((area) => area.trim())
				.filter(Boolean)
		: undefined;

	if (!name || !request) {
		console.error(usage);
		process.exit(1);
	}

	// Planning can run before a lightsout.config.json exists — fall back
	// to the default driver and harness defaults.
	const config = await loadConfig({ cwd }).catch(() => undefined);
	const driver = getDriver({ name: config?.driver ?? 'claude-code' });

	const result = await runPlanExplore({
		cwd,
		driver,
		request,
		name,
		areas,
		model: config?.model,
		permissionMode: config?.permissionMode,
		onProgress: createProgressPrinter(),
	});

	if (result.status === 'paused-rate-limit') {
		console.error(`\n${result.error}`);
		process.exit(1);
	}

	if (result.status === 'failed' || !result.facts) {
		console.error(`\n${result.error ?? 'plan explore failed'}`);
		process.exit(1);
	}

	const { verification } = result.facts;

	console.log(`\n${bold(`plan explore ${name}`)} — ${result.facts.areas.length} area(s), verified ${result.facts.verifiedAt}`);
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
