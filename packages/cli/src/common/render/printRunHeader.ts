import type { LightsoutConfig } from '@lightsout/contracts';
import type { Driver } from '@lightsout/drivers';

interface Params {
	config: LightsoutConfig;
	driver: Driver;
	cwd: string;
}

const describeStandards = ({ value, token }: { value: string[] | false | undefined; token: string }) => {
	if (value === false) {
		return 'none (explicit)';
	}

	if (value === undefined) {
		return `lightsout js defaults (none configured — set to false to disable, or list files/${token})`;
	}

	return value.join(', ');
};

export const printRunHeader = ({ config, driver, cwd }: Params): void => {
	const coverage = config.scripts.testCoverage === false ? 'off (explicit)' : config.scripts.testCoverage;

	console.log(`  cwd: ${cwd}`);
	console.log(`  standards: ${describeStandards({ value: config.standards, token: 'lightsout:code-defaults' })}`);
	console.log(`  test standards: ${describeStandards({ value: config.testStandards, token: 'lightsout:test-defaults' })}`);
	console.log(
		`  driver: ${driver.name} · model: ${config.model ?? 'harness default'} · permissions: ${config.permissionMode ?? 'acceptEdits'}`,
	);
	console.log(`  timeouts: agent ${config.timeouts?.agentMinutes ?? 60}m · supervisor ${config.timeouts?.supervisorMinutes ?? 15}m`);
	console.log(`  gates (root): check=[${config.scripts.check}] testUnit=[${config.scripts.testUnit}] coverage=[${coverage}]`);

	if (config.scripts.generate) {
		console.log(`  generate (before every gate set): [${config.scripts.generate}]`);
	}

	if (config.agentCommands && config.agentCommands.length > 0) {
		console.log(`  agent commands (granted, prefix match): ${config.agentCommands.map((command) => `[${command}]`).join(' ')}`);
	}

	if (config.generated) {
		console.log(`  generated (never attributed): ${config.generated.join(', ')}`);
	}

	if (config.scripts.build) {
		console.log(`  gates (root, opt-in): build=[${config.scripts.build}]`);
	}

	if (config.scripts.format) {
		console.log(`  format: [${config.scripts.format}]`);
	}

	if (config.packageScripts) {
		const scopedCoverage = config.packageScripts.testCoverage ? ` coverage=[${config.packageScripts.testCoverage}]` : '';

		console.log(`  gates (per package): check=[${config.packageScripts.check}] testUnit=[${config.packageScripts.testUnit}]${scopedCoverage}`);
	}
};
