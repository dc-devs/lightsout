import type { LightsoutConfig } from '#src/contracts/index.ts';
import { detectPriorArtCandidates } from '#src/plan/detectPriorArtCandidates.ts';

interface Params {
	cwd: string;
	/** Kebab plan name — what the nudge tells the reader to re-run `plan dedup` against. */
	name: string;
	planPaths: string[];
	config?: LightsoutConfig;
	onProgress: (message: string) => void;
}

/**
 * A cheap advisory backstop for the Dedup Review phase: when a plan's planned
 * symbols still name-collide with existing exports, nudge — but never gate.
 */
export const notePriorArtCollisions = async ({ cwd, name, planPaths, config, onProgress }: Params): Promise<void> => {
	const candidates = await detectPriorArtCandidates({ cwd, planPaths, config });

	if (candidates.length > 0) {
		onProgress(
			`plan grade ${name}: ${candidates.length} planned symbol(s) still name-collide with existing exports — run \`lightsout plan dedup --name ${name}\``,
		);
	}
};
