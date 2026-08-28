import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { DedupReport, type LightsoutConfig } from '#src/contracts/index.ts';
import type { PriorArtCandidate } from '#src/plan/common/types/PriorArtCandidate.ts';
import { detectPriorArtCandidates } from '#src/plan/detectPriorArtCandidates.ts';

interface Params {
	cwd: string;
	/** Kebab plan name — what the nudge tells the reader to re-run `plan dedup` against. */
	name: string;
	/** The plan's own folder, where a previous pass left `dedup.json`. */
	workspaceDir: string;
	planPaths: string[];
	config?: LightsoutConfig;
	onProgress: (message: string) => void;
}

/** One collision's identity across runs. The same name planned at two paths, or in two plan files, is two collisions. */
const collisionKey = ({ plannedSymbol, plannedPath, phase }: { plannedSymbol: string; plannedPath: string; phase: string }): string =>
	`${phase} ${plannedPath} ${plannedSymbol}`;

/**
 * What a previous `plan dedup` already ruled on, as comparable keys.
 *
 * Every failure reads as an empty set, which restores the older, noisier nudge
 * rather than silencing it: no `dedup.json` yet, a hand-edit that no longer
 * parses, and a report written before the field existed all mean "nothing is
 * recorded as settled". This is one advisory line on a grade that has already
 * done its real work, so it never throws.
 */
const readSettledCollisions = async ({ workspaceDir }: { workspaceDir: string }): Promise<Set<string>> => {
	const text = await readFile(join(workspaceDir, 'dedup.json'), 'utf8').catch(() => undefined);

	if (text === undefined) {
		return new Set();
	}

	try {
		const parsed = DedupReport.safeParse(JSON.parse(text));

		return parsed.success ? new Set(parsed.data.reviewed.map(collisionKey)) : new Set();
	} catch {
		return new Set();
	}
};

/**
 * A cheap advisory backstop for the Dedup Review phase: when a plan's planned
 * symbols name-collide with existing exports and no dedup pass has weighed
 * them, nudge — but never gate.
 *
 * The nudge says "run `plan dedup`", so it is only ever an argument about
 * collisions dedup has not seen. A collision it already ruled on stays
 * detectable on disk whenever the resolution was to keep both files — `defer`
 * and `distinct` both do — and re-reporting it made every later grade pass
 * repeat a finding with no work left in it.
 */
export const notePriorArtCollisions = async ({ cwd, name, workspaceDir, planPaths, config, onProgress }: Params): Promise<void> => {
	const candidates: PriorArtCandidate[] = await detectPriorArtCandidates({ cwd, planPaths, config });
	const settled = await readSettledCollisions({ workspaceDir });
	const unweighed = candidates.filter((candidate) => !settled.has(collisionKey(candidate)));

	if (unweighed.length > 0) {
		onProgress(
			`plan grade ${name}: ${unweighed.length} planned symbol(s) still name-collide with existing exports — run \`lightsout plan dedup --name ${name}\``,
		);
	}
};
