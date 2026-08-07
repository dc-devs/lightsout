import { detectStandardsChannels, readStandards } from '@/standards';
import type { LightsoutConfig } from '@/contracts';
import { dim } from '@/cli/common/terminal/dim';
import { messageOf } from '@/common/utils/messageOf';

interface Params {
	cwd: string;
	config: LightsoutConfig | undefined;
}

// Standards are SUPPLEMENTAL for planning (load-if-configured, non-fatal if
// absent) — resolved once and threaded into draft, dedup, and grade, exactly
// the mechanism the implement pipeline uses.
export const loadPlanningStandards = async ({ cwd, config }: Params): Promise<string | undefined> => {
	const packagesDir = config?.packagesDir ?? 'packages';
	const standardsPaths = config?.standards === false ? [] : (config?.standards ?? ['lightsout:code-defaults']);
	let standards: string | undefined;

	try {
		const channels = config?.standardsChannels ?? (await detectStandardsChannels({ cwd, packagesDir, packages: [] }));

		standards = await readStandards({ cwd, paths: standardsPaths, channels });
	} catch (error) {
		console.log(dim(`standards not loaded (non-fatal): ${messageOf({ error })}`));
		standards = undefined;
	}

	return standards;
};
