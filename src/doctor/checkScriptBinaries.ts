import type { LightsoutConfig } from '@/contracts';
import { runCommand } from '@/common/utils/runCommand';
import { probeTimeoutMs } from '@/doctor/common/constants/probeTimeoutMs';
import type { DoctorCheck } from '@/doctor/common/types/DoctorCheck';

interface Params {
	cwd: string;
	config: LightsoutConfig;
}

/** Every gate command's leading binary must resolve on PATH — a missing one fails every run that depends on it. */
export const checkScriptBinaries = async ({ cwd, config }: Params): Promise<DoctorCheck> => {
	const scriptCommands = [...Object.values(config.scripts), ...Object.values(config.packageScripts ?? {})].filter(
		(value): value is string => typeof value === 'string',
	);
	const binaries = [...new Set(scriptCommands.map((command) => command.trim().split(/\s+/)[0]).filter(Boolean))];
	const missingBinaries: string[] = [];

	for (const name of binaries) {
		const result = await runCommand({ command: `command -v ${name}`, cwd, timeoutMs: probeTimeoutMs }).catch(() => ({ exitCode: -1 }));

		if (result.exitCode !== 0) {
			missingBinaries.push(name as string);
		}
	}

	return missingBinaries.length === 0
		? { id: 'script-binaries', status: 'pass', detail: `gate commands resolve (${binaries.join(', ')})` }
		: {
				id: 'script-binaries',
				status: 'fail',
				detail: `not on PATH: ${missingBinaries.join(', ')}`,
				fix: 'install the missing tool(s) — every gate depends on them',
			};
};
