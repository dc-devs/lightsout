import { dim } from '#src/cli/common/terminal/dim.ts';
import { messageOf } from '#src/common/utils/messageOf.ts';
import type { LightsoutConfig } from '#src/contracts/index.ts';
import { resolveStandardsChannels } from '#src/standards/index.ts';
import { buildStandardsDocuments, resolveStandardsPacks } from '#src/standardsPacks/index.ts';

interface Params {
	cwd: string;
	config: LightsoutConfig | undefined;
}

// Standards are SUPPLEMENTAL for planning (load-if-configured, non-fatal if
// absent) — resolved once and threaded into draft, dedup, and grade, exactly
// the mechanism the implement pipeline uses. Only the code set: planning writes
// a plan, not tests.
export const readPlanningStandards = async ({ cwd, config }: Params): Promise<string | undefined> => {
	let standards: string | undefined;

	try {
		const channels = await resolveStandardsChannels({ cwd, config, packages: [] });
		const loaded = await resolveStandardsPacks({ cwd, config });
		const texts = loaded.map((pack) => buildStandardsDocuments({ pack, channels }).code).filter((text) => text !== undefined);

		standards = texts.length === 0 ? undefined : texts.join('\n\n');
	} catch (error) {
		console.log(dim(`standards not loaded (non-fatal): ${messageOf({ error })}`));
		standards = undefined;
	}

	return standards;
};
