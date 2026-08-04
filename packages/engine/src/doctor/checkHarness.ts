import type { LightsoutConfig } from '@lightsout/contracts';
import { runCommand } from '../common/utils/runCommand';
import { probeTimeoutMs } from './common/constants/probeTimeoutMs';
import type { DoctorCheck } from './common/types/DoctorCheck';

const driverBinaries: Record<string, string> = { 'claude-code': 'claude', codex: 'codex' };

const getReferencedDriverNames = ({ config }: { config: LightsoutConfig }) => {
	const entryDrivers = Object.values(config.commands ?? {}).map((entry) => entry?.driver);
	const names = [config.driver ?? 'claude-code', ...entryDrivers].filter((name): name is string => typeof name === 'string');

	return [...new Set(names)];
};

interface Params {
	cwd: string;
	config: LightsoutConfig;
	/** Test seam for the harness binary probe — defaults to running `<binary> --version`. */
	probeHarness?: (params: { binary: string }) => Promise<{ exitCode: number; stdout: string; stderr: string }>;
}

/** Probe every harness binary the config references — the global driver plus per-command overrides. A fail means some command has no harness to shell. */
export const checkHarness = async ({ cwd, config, probeHarness }: Params): Promise<DoctorCheck> => {
	const probe = probeHarness ?? (({ binary: name }) => runCommand({ command: `${name} --version`, cwd, timeoutMs: probeTimeoutMs }));
	const binaries = [...new Set(getReferencedDriverNames({ config }).map((name) => driverBinaries[name] ?? name))];
	const versions: string[] = [];
	const failures: { binary: string; detail: string; fix: string }[] = [];

	for (const binary of binaries) {
		try {
			const probed = await probe({ binary });

			if (probed.exitCode === 0) {
				versions.push(`${binary} ${probed.stdout.trim().split('\n')[0]}`);
			} else {
				failures.push({
					binary,
					detail: `\`${binary} --version\` exited ${probed.exitCode}: ${`${probed.stdout}\n${probed.stderr}`.trim().slice(0, 200)}`,
					fix: `reinstall or repair the ${binary} CLI — the engine shells your own logged-in binary and cannot run without it`,
				});
			}
		} catch (error) {
			failures.push({
				binary,
				detail: `${binary} not runnable: ${error instanceof Error ? error.message : String(error)}`,
				fix: `install the ${binary} CLI and log in`,
			});
		}
	}

	return failures.length === 0
		? { id: 'harness', status: 'pass', detail: `${versions.join(' · ')} (login not probed — the first run verifies it)` }
		: {
				id: 'harness',
				status: 'fail',
				detail: failures.map((failure) => failure.detail).join('\n'),
				fix: failures.map((failure) => failure.fix).join('\n'),
			};
};
