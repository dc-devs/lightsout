import { type LightsoutConfig, Permissions } from '#src/contracts/index.ts';
import type { Driver } from '#src/drivers/index.ts';

interface Params {
	config: LightsoutConfig;
	driver: Driver;
	cwd: string;
}

const describeStandardsPackages = ({ value }: { value: string[] | false | undefined }) => {
	if (value === false) {
		return 'none (explicit)';
	}

	if (value === undefined) {
		return 'lightsout-defaults (none configured — set to false to disable, or list package roots)';
	}

	return value.join(', ');
};

export const printRunHeader = ({ config, driver, cwd }: Params): void => {
	const coverage = config.gates['test-coverage'] === false ? 'off (explicit)' : config.gates['test-coverage'];

	console.log(`  cwd: ${cwd}`);
	console.log(`  standards packages: ${describeStandardsPackages({ value: config['standards-packages'] })}`);
	console.log(
		`  harness: ${driver.name} · model: ${config.model ?? 'harness default'} · effort: ${config.effort ?? 'harness default'} · permissions: ${config.permissions ?? Permissions.Write}`,
	);
	console.log(`  timeouts: agent ${config.timeouts?.['agent-minutes'] ?? 60}m · supervisor ${config.timeouts?.['supervisor-minutes'] ?? 15}m`);
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
