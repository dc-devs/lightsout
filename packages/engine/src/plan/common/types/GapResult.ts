import type { GapCheckLens } from '#src/contracts/plan/grade/GapCheckLens.ts';
import type { GapCheckReport } from '#src/contracts/plan/grade/GapCheckReport.ts';
import type { AgentOutcome } from '#src/invoke/common/types/AgentOutcome.ts';

/** One gap checker's settled result, labelled with the pair it was spawned for. */
export interface GapResult {
	phase: string;
	lens: GapCheckLens;
	outcome: AgentOutcome<GapCheckReport>;
}
