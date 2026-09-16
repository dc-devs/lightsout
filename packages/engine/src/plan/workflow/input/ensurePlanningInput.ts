import { sha256 } from '#src/common/utils/sha256.ts';
import { type PlanningArtifact, PlanningVocabulary } from '#src/contracts/index.ts';
import { capturePlanningInput } from '#src/plan/workflow/capturePlanningInput.ts';
import type { PlanningRuntime } from '#src/plan/workflow/common/types/PlanningRuntime.ts';
import type { PlanningSnapshot } from '#src/plan/workflow/common/types/PlanningSnapshot.ts';
import { readLegacyPlanningFiles } from '#src/plan/workflow/input/common/utils/readLegacyPlanningFiles.ts';
import { importPlanningWorkspace, planningDataArtifact, readPlanningEntrySnapshot } from '#src/plan/workflow/store/index.ts';

interface Params {
	runtime: PlanningRuntime;
}

/** Import full original legacy inputs once; modern entry preserves canonical authority and adds only missing stage work. */
export const ensurePlanningInput = async ({ runtime }: Params): Promise<PlanningSnapshot> => {
	const { cwd, name } = runtime;
	let snapshot = await readPlanningEntrySnapshot({ cwd, name });
	if (!snapshot) {
		const files = await readLegacyPlanningFiles({ cwd, name });
		const sources = [...files].map(([artifact, text]) => ({ artifact, locator: 'Complete original file', text, sha256: sha256({ content: text }) }));
		const artifacts: Array<{ descriptor: PlanningArtifact; content: string }> = [...files].map(([path, content]) => ({
			descriptor: {
				...planningDataArtifact({ path, content }),
				...(path === 'plan.md' ? { variant: PlanningVocabulary.Artifact.Single } : {}),
				...(path === 'overview.md' ? { variant: PlanningVocabulary.Artifact.Overview } : {}),
				...(/^phase\d+.*\.md$/.test(path) ? { variant: PlanningVocabulary.Artifact.Phase, phaseId: `legacy-phase:${path}` } : {}),
			},
			content,
		}));
		for (const source of sources) {
			const path = `planning-originals/${source.sha256}.txt`;
			if (!artifacts.some((item) => item.descriptor.path === path))
				artifacts.push({ descriptor: planningDataArtifact({ path, content: source.text }), content: source.text });
		}
		const memory = files.get('grade-memory.json');
		snapshot = await importPlanningWorkspace({
			cwd,
			name,
			inputs: {
				input: { stage: runtime.stage, sources, claims: [], confirmations: [] },
				artifacts,
				legacyDecisions: [...files]
					.filter(([path]) => path === 'decisions.json' || path === 'brainstorm-decisions.json')
					.map(([path, content]) => ({ path, content })),
				...(memory === undefined ? {} : { legacyFindings: { path: 'grade-memory.json', content: memory } }),
			},
		});
	}
	if (!snapshot.record.work.some((work) => work.stage === runtime.stage))
		snapshot = await capturePlanningInput({ runtime, input: { stage: runtime.stage, sources: [], claims: [], confirmations: [] } });
	return snapshot;
};
