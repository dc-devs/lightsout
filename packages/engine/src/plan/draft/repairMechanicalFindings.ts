import { readFile } from 'node:fs/promises';
import { basename } from 'node:path';
import type { DecisionsRecord } from '#src/contracts/index.ts';
import type { PhaseDeclaration } from '#src/plan/common/types/PhaseDeclaration.ts';
import type { SyncedPlanFile } from '#src/plan/common/types/SyncedPlanFile.ts';
import { syncPlanDecisions } from '#src/plan/decisionLog/index.ts';
import { stampPhaseCounts } from '#src/plan/draft/stampPhaseCounts.ts';
import { parsePlan } from '#src/plan/parsePlan.ts';
import { syncGlobalConstraints, syncPhaseSections } from '#src/plan/sections/index.ts';

interface Params {
	cwd: string;
	/** Kebab plan name — what `syncPlanDecisions` resolves the workspace by. */
	name: string;
	/** Absolute paths of every plan file of this deliverable, the overview included. */
	planPaths: string[];
	/** The merged record the draft was started from. */
	decisions: DecisionsRecord;
	/** Absolute path of the overview when the deliverable is phased; absent for a standalone plan. */
	overviewPath?: string;
}

/**
 * The stamped rows with each matched row's declared budget replaced by the
 * budget its own phase file states.
 *
 * With both copies rendered from one record, one of them has to be
 * authoritative, and it is the phase file's — that is the file the implementing
 * agent is handed. `stampPhaseCounts` deliberately does not stamp this bullet,
 * and it is right not to: the check it serves has to be able to see the two
 * copies disagree. Here the question is different, so the answer is. What
 * survives is the defect that actually needs judgment — a budget below the
 * phase's own touched count, where shrinking the phase and raising the number
 * are both choices no code can make.
 *
 * The substitution is defined only over rows a phase file was found for, so a
 * row naming a file this deliverable does not have is left exactly as parsed and
 * is not rendered at all.
 */
const withOwnBudgets = async ({ declarations, phasePaths }: { declarations: PhaseDeclaration[]; phasePaths: string[] }) => {
	const budgets = new Map<string, number | undefined>();

	for (const phasePath of phasePaths) {
		const base = basename(phasePath);

		budgets.set(base, parsePlan({ content: await readFile(phasePath, 'utf8'), base }).fileBudget);
	}

	return declarations.map((declaration) => (budgets.has(declaration.file) ? { ...declaration, fileBudget: budgets.get(declaration.file) } : declaration));
};

/**
 * Regenerate everything the engine owns in a drafted plan, in code, before a
 * repair round lints it: the Decision Log, the Global Constraints, the stamped
 * phase counts, and the paired `## Phases` row and `### Phase <N> — ` block.
 *
 * A sibling of `repairPlanStructure` and `repairPhaseBreakdown` that spawns
 * nothing. Each of the four is settled by a record the engine already holds, so
 * a defect in one is bookkeeping rather than judgment, and an agent attempt
 * spent on it is an attempt not spent on the plan.
 *
 * The order of the four steps is this function's contract. The phase sections
 * are rendered from the record `stampPhaseCounts` returns, so the stamp has to
 * run first — rendering before it would write the overview agent's estimate back
 * over the real counts.
 *
 * It never chooses between conflicting design alternatives. Every other finding
 * — a path that does not exist, a hand-off that does not chain, a missing
 * acceptance-test row, a scope that busts the ceiling — is left exactly as it
 * was for the agent round that follows.
 *
 * A standalone plan passes no `overviewPath`, and the two phase steps do not
 * run: there is no `## Phases` table to stamp, and a stamp attempted against one
 * would rewrite nothing while reporting that it had.
 */
export const repairMechanicalFindings = async ({ cwd, name, planPaths, decisions, overviewPath }: Params): Promise<SyncedPlanFile[]> => {
	const synced = await syncPlanDecisions({ cwd, name, planPaths, decisions });
	const files: SyncedPlanFile[] = [...('files' in synced ? synced.files : []), ...(await syncGlobalConstraints({ planPaths, decisions }))];

	if (overviewPath !== undefined) {
		const phasePaths = planPaths.filter((path) => path !== overviewPath);
		const stamped = await stampPhaseCounts({ overviewPath, phasePaths });

		files.push(
			await syncPhaseSections({
				overviewPath,
				declarations: await withOwnBudgets({ declarations: stamped, phasePaths }),
				phaseFiles: phasePaths.map((path) => basename(path)),
			}),
		);
	}

	return files;
};
