import type { GapCheckLens, GapCheckReport } from '#src/contracts/index.ts';
import type { AgentOutcome } from '#src/invoke/index.ts';

/** One gap checker's settled result, labelled with the pair it was spawned for. */
export interface GapResult {
	phase: string;
	lens: GapCheckLens;
	outcome: AgentOutcome<GapCheckReport>;
}
