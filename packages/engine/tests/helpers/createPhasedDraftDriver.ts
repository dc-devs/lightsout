import { writeFileSync } from 'node:fs';
import { PlanVariant } from '#src/contracts/index.ts';
import type { Driver } from '#src/drivers/index.ts';
import { cleanPlanBody } from '#tests/helpers/cleanPlanBody.ts';
import { expectDefined } from '#tests/helpers/expectDefined.ts';
import { overviewBody } from '#tests/helpers/phasePlan.ts';

/** A structurally clean overview file — one declared phase, its counts equal to what that phase file lists. */
const cleanOverview = () => overviewBody({ rows: [{ file: 'phase1-core.md', scope: 'the core', created: 1, touched: 1 }] });

/**
 * The phased writer stub, answering both stages of the two-stage draft: an
 * overview spawn writes `overview.md` alone, and each phase spawn writes the one
 * phase file its prompt names. Which stage it is in is read off the brief the
 * builder emitted, exactly as a real writer would.
 */
export const createPhasedDraftDriver = ({
	onCall,
	phaseBody = cleanPlanBody({ reference: true }),
}: {
	onCall?: (prompt: string) => void;
	phaseBody?: string;
} = {}): Driver => ({
	name: 'stub',
	invoke: async ({ prompt }) => {
		onCall?.(prompt);

		const path = /- (\S+\.md)/.exec(prompt)?.[1];

		// the engine dictates one output path per spawn
		expectDefined(path);

		const phase = prompt.includes('## Phase authoring');

		writeFileSync(path, phase ? phaseBody : cleanOverview());

		return {
			text: JSON.stringify({
				status: 'drafted',
				filesWritten: [{ path, variant: phase ? PlanVariant.Phase : PlanVariant.Overview, scope: phase ? 'the core' : 'phased' }],
				decisionsApplied: 0,
				assumptions: [],
				discrepancies: [],
			}),
			exitCode: 0,
		};
	},
});
