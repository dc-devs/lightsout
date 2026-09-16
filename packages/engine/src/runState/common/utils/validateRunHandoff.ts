import { canonicalJson } from '#src/common/utils/canonicalJson.ts';
import type { RunManifest } from '#src/contracts/index.ts';

interface Params {
	previous?: RunManifest;
	manifest: RunManifest;
}
export const validateRunHandoff = ({ previous, manifest }: Params): void => {
	if (previous && canonicalJson({ value: previous.planningHandoff ?? null }) !== canonicalJson({ value: manifest.planningHandoff ?? null }))
		throw new Error('An existing run cannot replace or remove its planning handoff');
	if (
		previous?.planningHandoff &&
		(previous.plan !== manifest.plan || previous.overview !== manifest.overview || previous.parentRunId !== manifest.parentRunId)
	)
		throw new Error('A frozen run cannot change its plan or coordinator');
};
