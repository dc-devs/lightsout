import { generatedPlanRegions } from '#src/plan/common/constants/generatedPlanRegions.ts';
import { getPlanDesignHash } from '#src/plan/common/scope/getPlanDesignHash.ts';
import type { ParsedPlan } from '#src/plan/common/types/ParsedPlan.ts';
import { parsePhaseDeclarations } from '#src/plan/parsePhaseDeclarations.ts';

/** The overview's two engine-composed sections whose spans describe ONE phase rather than every phase. */
const perPhaseRegions = [generatedPlanRegions.phases, generatedPlanRegions.phaseDeclarations];

interface Params {
	/** The parsed `overview.md`. */
	overview: ParsedPlan;
	/** Every phase-file basename this plan has now. */
	phaseFiles: string[];
}

type OverviewDesignHashes = { shared: string; attributed: Map<string, string> } | { error: string; shared: string };

/** The overview lines a span covers, as one text — a 1-based inclusive range, as the parser states it. */
const textOf = ({ overview, start, end }: { overview: ParsedPlan; start: number; end: number }) => overview.lines.slice(start - 1, end).join('\n');

/**
 * Split a phased plan's overview into the text every phase shares and the text
 * describing one phase alone.
 *
 * A phase's row in `## Phases` and its `### Phase <N>` block in
 * `## Phase Declarations` are about that phase and nothing else, so their
 * content belongs in that phase's own design hash rather than in the overview's.
 * Every other overview section, `## Cross-Phase Dependencies` included, is text
 * every phase reads and stays shared. The spans are located through the line
 * provenance `parsePhaseDeclarations` records, never by scanning the two
 * sections again: a second reader of the table would be a second answer to where
 * a phase's overview content is, and the two would agree only by accident.
 *
 * The checks run in a fixed order and the first to fail is the answer, as
 * `getDecisionReach`'s do. Every one of them is a span the engine cannot place —
 * a declaration missing its row or its block, a declaration naming no phase file
 * of this plan, or a phase file the overview declares nowhere — and a reach that
 * cannot be placed makes the whole overview shared, which widens the pass. That
 * branch keeps both per-phase sections in `shared`, so nothing in them goes
 * unmeasured.
 *
 * @returns the overview's shared design hash with the overview text credited to
 * each phase, or the shared hash beside the reason no span could be credited
 */
export const getOverviewDesignHashes = ({ overview, phaseFiles }: Params): OverviewDesignHashes => {
	const declarations = parsePhaseDeclarations({ plan: overview });
	const unplaceable = ({ reason }: { reason: string }): OverviewDesignHashes => ({
		error: reason,
		shared: getPlanDesignHash({ plan: overview, keepRegions: perPhaseRegions }),
	});
	const attributed = new Map<string, string>();
	const spanless: string[] = [];

	for (const { file, rowLine, blockRange } of declarations) {
		if (rowLine === undefined || blockRange === undefined) {
			spanless.push(file);

			continue;
		}

		attributed.set(file, [textOf({ overview, start: rowLine, end: rowLine }), textOf({ overview, ...blockRange })].join('\n'));
	}

	if (spanless.length > 0) {
		return unplaceable({ reason: `the overview declares ${spanless.join(', ')} with no row or no declaration block, so that span belongs to no phase` });
	}

	const foreign = [...attributed.keys()].filter((file) => !phaseFiles.includes(file));

	if (foreign.length > 0) {
		return unplaceable({ reason: `the overview credits text to ${foreign.join(', ')}, which is not a phase file of this plan` });
	}

	const undeclared = phaseFiles.filter((file) => !attributed.has(file));

	if (undeclared.length > 0) {
		return unplaceable({
			reason: `the overview declares nothing for ${undeclared.join(', ')}, so that phase file's overview text cannot be told from the shared text`,
		});
	}

	return { shared: getPlanDesignHash({ plan: overview }), attributed };
};
