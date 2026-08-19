import { dim } from '@/cli/common/terminal/dim';
import { messageOf } from '@/common/utils/messageOf';
import type { LightsoutConfig } from '@/contracts';
import { detectStandardsChannels } from '@/standards';
import { buildStandardsDocuments, resolveStandardsPackages } from '@/standardsPackages';

interface Params {
	cwd: string;
	config: LightsoutConfig | undefined;
}

// Standards are SUPPLEMENTAL for planning (load-if-configured, non-fatal if
// absent) — resolved once and threaded into draft, dedup, and grade, exactly
// the mechanism the implement pipeline uses. Only the code set: planning writes
// a plan, not tests.
export const loadPlanningStandards = async ({ cwd, config }: Params): Promise<string | undefined> => {
	const packagesDir = config?.['packages-dir'] ?? 'packages';
	let standards: string | undefined;

	try {
		const channels = config?.['standards-channels'] ?? (await detectStandardsChannels({ cwd, packagesDir, packages: [] }));
		const loaded = await resolveStandardsPackages({ cwd, config });
		const texts = loaded.map((pkg) => buildStandardsDocuments({ pkg, channels }).code).filter((text) => text !== undefined);

		standards = texts.length === 0 ? undefined : texts.join('\n\n');
	} catch (error) {
		console.log(dim(`standards not loaded (non-fatal): ${messageOf({ error })}`));
		standards = undefined;
	}

	return standards;
};
