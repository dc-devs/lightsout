import { restoreBrainstormFiles } from '#src/brainstorm/restore/restoreBrainstormFiles.ts';
import { readOptionalConfig } from '#src/common/config/readOptionalConfig.ts';
import { parsePlanAddress } from '#src/common/planAddress/parsePlanAddress.ts';
import { planNumberOf } from '#src/common/planAddress/planNumberOf.ts';
import { planWorkspaceDir } from '#src/plan/planWorkspaceDir.ts';
import { readPlanWorkOrderRef } from '#src/plan/readPlanWorkOrderRef.ts';
import { resolveTrackerSettings } from '#src/ticketTracker/resolveTrackerSettings.ts';

interface Params {
	cwd: string;
	/** Kebab plan name — the folder the fetched files land in. */
	name: string;
	/** Where the "fetched from the ticket" line goes — stdout by default, so a test reads what was printed. */
	write?: (line: string) => void;
}

/** Say what one restore did, in the same two lines whichever generation it took. */
const report = ({
	restored,
	skipped,
	identifier,
	dir,
	write,
}: {
	restored: string[];
	skipped: string[];
	identifier: string;
	dir: string;
	write: (line: string) => void;
}) => {
	if (restored.length > 0) {
		write(`lightsout: fetched ${restored.length} brainstorm file(s) from ticket ${identifier} into ${dir}`);
	}

	if (skipped.length > 0) {
		write(`lightsout: kept the local ${skipped.join(', ')} — ticket ${identifier} also carries ${skipped.length > 1 ? 'them' : 'it'}`);
	}
};

/**
 * Fetch a ticket's published brainstorm into its plan folder, at planning's
 * first command edge.
 *
 * A plan addressed inside a ticket folder takes the generation published under
 * its own plan id. Plan 001 falls back to the ticket's bare-title generation
 * when its prefix carries none, because a ticket brainstormed before ticket
 * records existed carries its notes under bare titles and that generation can
 * only belong to the ticket's first plan; no later plan number falls back.
 *
 * It answers nothing and never blocks, which is the one way it differs from
 * `ensurePlanWorkspace`: planning must still run in a repo with no
 * `lightsout.config.json`, and a ticket with no published brainstorm is the
 * ordinary case rather than a failure. Only a tracker read that was attempted
 * and failed prints anything, and planning carries on regardless.
 */
export const ensureBrainstormFiles = async ({ cwd, name, write = console.log }: Params): Promise<void> => {
	// Unguarded: a config the engine cannot parse must fail loudly here, exactly
	// as it does in `ensurePlanWorkspace`.
	const config = await readOptionalConfig({ cwd });

	if (config === undefined) {
		return;
	}

	const trackerSettings = resolveTrackerSettings({ config, env: process.env });

	if ('error' in trackerSettings) {
		return;
	}

	const identifier = await readPlanWorkOrderRef({ cwd, name });

	if (identifier === undefined) {
		return;
	}

	const dir = await planWorkspaceDir({ cwd, name });
	const titlePrefix = parsePlanAddress({ name })?.planId;
	const own = await restoreBrainstormFiles({ cwd, name, identifier, settings: trackerSettings, titlePrefix });

	// Only a ticket's first plan may take the bare-title generation, because a
	// bare generation can belong to no other plan.
	const firstPlanNumber = 1;
	const isFirstPlan = titlePrefix !== undefined && planNumberOf({ id: titlePrefix }) === firstPlanNumber;
	const emptyPrefix = own.error === undefined && own.restored.length === 0 && own.skipped.length === 0;
	const taken = isFirstPlan && emptyPrefix ? await restoreBrainstormFiles({ cwd, name, identifier, settings: trackerSettings }) : own;

	if (taken.error !== undefined) {
		write(`lightsout: could not fetch the brainstorm from ticket ${identifier}: ${taken.error}`);
	} else {
		report({ restored: taken.restored, skipped: taken.skipped, identifier, dir, write });
	}
};
