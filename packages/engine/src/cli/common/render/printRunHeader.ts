import { printConfigSource } from '#src/cli/common/render/printConfigSource.ts';
import { defaultAgentTimeoutMinutes } from '#src/common/constants/defaultAgentTimeoutMinutes.ts';
import { defaultGateTimeoutMinutes } from '#src/common/constants/defaultGateTimeoutMinutes.ts';
import { defaultSupervisorTimeoutMinutes } from '#src/common/constants/defaultSupervisorTimeoutMinutes.ts';
import type { LightsoutConfig } from '#src/contracts/LightsoutConfig.ts';
import { Permissions } from '#src/contracts/Permissions.ts';
import type { Driver } from '#src/drivers/common/types/Driver.ts';

interface Params {
	config: LightsoutConfig;
	driver: Driver;
	cwd: string;
	/** The absolute path of the config file the run loaded — not always under `cwd`, which is where the run builds. */
	configPath: string;
}

const describeStandardsPacks = ({ value }: { value: string[] | false | undefined }) => {
	if (value === false) {
		return 'none (explicit)';
	}

	if (value === undefined) {
		return 'lightsout-defaults (none configured — set to false to disable, or list pack roots)';
	}

	return value.join(', ');
};

export const printRunHeader = ({ config, driver, cwd, configPath }: Params): void => {
	const coverage = config.gates['test-coverage'] === false ? 'off (explicit)' : config.gates['test-coverage'];

	console.log(`  cwd: ${cwd}`);
	printConfigSource({ configPath });
	console.log(`  standards packs: ${describeStandardsPacks({ value: config['standards-packs'] })}`);
	console.log(
		`  harness: ${driver.name} · model: ${config.model ?? 'harness default'} · effort: ${config.effort ?? 'harness default'} · permissions: ${config.permissions ?? Permissions.Write}`,
	);
	console.log(
		`  timeouts: agent ${config.timeouts?.['agent-minutes'] ?? defaultAgentTimeoutMinutes}m · supervisor ${config.timeouts?.['supervisor-minutes'] ?? defaultSupervisorTimeoutMinutes}m · gate ${config.timeouts?.['gate-minutes'] ?? defaultGateTimeoutMinutes}m`,
	);
	console.log(`  gates (root): check=[${config.gates.check}] test=[${config.gates.test}] coverage=[${coverage}]`);

	if (config.gates.generate) {
		console.log(`  generate (before every gate set): [${config.gates.generate}]`);
	}

	if (config['agent-commands'] && config['agent-commands'].length > 0) {
		console.log(`  agent commands (granted, prefix match): ${config['agent-commands'].map((command) => `[${command}]`).join(' ')}`);
	}

	if (config.generated) {
		console.log(`  generated (never attributed): ${config.generated.join(', ')}`);
	}

	if (config.vendored) {
		console.log(`  vendored (never checked, still attributed): ${config.vendored.join(', ')}`);
	}

	if (config.gates.build) {
		console.log(`  gates (root, opt-in): build=[${config.gates.build}]`);
	}

	if (config.gates.format) {
		console.log(`  format: [${config.gates.format}]`);
	}

	if (config['package-gates']) {
		const scopedCoverage = config['package-gates']['test-coverage'] ? ` coverage=[${config['package-gates']['test-coverage']}]` : '';

		console.log(`  gates (per package): check=[${config['package-gates'].check}] test=[${config['package-gates'].test}]${scopedCoverage}`);
	}
};
