import type { LightsoutConfig } from '@lightsout/contracts';
import { runCommand } from '../common/utils/runCommand';
import { probeTimeoutMs } from './common/constants/probeTimeoutMs';
import type { DoctorCheck } from './common/types/DoctorCheck';

const driverBinaries: Record<string, string> = { 'claude-code': 'claude', codex: 'codex' };

interface Params {
	cwd: string;
	config: LightsoutConfig;
	/** Test seam for the harness binary probe — defaults to running `<binary> --version`. */
	probeHarness?: (params: { binary: string }) => Promise<{ exitCode: number; stdout: string; stderr: string }>;
}

/** Probe the configured driver's binary (`claude`/`codex`) — a fail here means the engine has no harness to shell. */
export const checkHarness = async ({ cwd, config, probeHarness }: Params): Promise<DoctorCheck> => {
	const binary = driverBinaries[config.driver ?? 'claude-code'] ?? (config.driver as string);
	const probe = probeHarness ?? (({ binary: name }) => runCommand({ command: `${name} --version`, cwd, timeoutMs: probeTimeoutMs }));

	try {
		const probed = await probe({ binary });

		return probed.exitCode === 0
			? { id: 'harness', status: 'pass', detail: `${binary} ${probed.stdout.trim().split('\n')[0]} (login not probed — the first run verifies it)` }
			: {
					id: 'harness',
					status: 'fail',
					detail: `\`${binary} --version\` exited ${probed.exitCode}: ${`${probed.stdout}\n${probed.stderr}`.trim().slice(0, 200)}`,
					fix: `reinstall or repair the ${binary} CLI — the engine shells your own logged-in binary and cannot run without it`,
				};
	} catch (error) {
		return {
			id: 'harness',
			status: 'fail',
			detail: `${binary} not runnable: ${error instanceof Error ? error.message : String(error)}`,
			fix: `install the ${binary} CLI and log in`,
		};
	}
};
