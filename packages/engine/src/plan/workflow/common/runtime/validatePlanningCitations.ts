import { sha256 } from '#src/common/utils/sha256.ts';
import { type PlanningCitation, type PlanningDependency, PlanningVocabulary } from '#src/contracts/index.ts';
import { readPlanningSource } from '#src/plan/workflow/common/evidence/readPlanningSource.ts';
import type { PlanningSnapshot } from '#src/plan/workflow/common/types/PlanningSnapshot.ts';

interface Params {
	cwd: string;
	snapshot: PlanningSnapshot;
	dependencies: PlanningDependency[];
	citations: PlanningCitation[];
}

/** A citation must identify captured bytes or an acquired current content dependency, and quote text they actually contain. */
export const validatePlanningCitations = async ({ cwd, snapshot, dependencies, citations }: Params): Promise<void> => {
	for (const citation of citations) {
		let content = snapshot.artifacts.get(citation.artifact);
		if (content === undefined) {
			const observed = dependencies.some(
				(dependency) =>
					dependency.kind === PlanningVocabulary.Dependency.Content && dependency.path === citation.artifact && dependency.sha256 === citation.sha256,
			);
			if (!observed) throw new Error(`Citation is not backed by acquired evidence: ${citation.artifact}`);
			content = (await readPlanningSource({ cwd, path: citation.artifact }))?.content;
		}
		if (content === undefined || sha256({ content }) !== citation.sha256 || !content.includes(citation.quote))
			throw new Error(`Citation does not match its current source bytes: ${citation.artifact}`);
	}
};
