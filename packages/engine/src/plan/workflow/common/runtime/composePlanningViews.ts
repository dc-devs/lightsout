import { canonicalJson } from '#src/common/utils/canonicalJson.ts';
import { sha256 } from '#src/common/utils/sha256.ts';
import { type PlanningRecord, PlanningVocabulary } from '#src/contracts/index.ts';
import { parsePlan } from '#src/plan/parsePlan.ts';
import type { PlanningRuntime } from '#src/plan/workflow/common/types/PlanningRuntime.ts';
import type { PlanningSnapshot } from '#src/plan/workflow/common/types/PlanningSnapshot.ts';

interface Params {
	runtime: PlanningRuntime;
	previous: PlanningSnapshot;
	record: PlanningRecord;
	artifacts: ReadonlyMap<string, string>;
	authoring?: boolean;
}

const meaning = ({ record }: { record: PlanningRecord }) =>
	canonicalJson({
		value: {
			sources: record.sources,
			claims: record.claims,
			standards: record.standards,
			artifacts: record.artifacts.filter((artifact) => artifact.variant !== PlanningVocabulary.Artifact.Data),
		},
	});

/** Project semantic changes before author receipts, or within a non-authoring transaction such as an answer or standards refresh. */
export const composePlanningViews = ({ runtime, previous, record, artifacts, authoring = false }: Params): ReadonlyMap<string, string> => {
	let result = artifacts;
	if (runtime.services.render && (authoring || meaning({ record }) !== meaning({ record: previous.record }))) {
		const established = previous.record.artifacts.some(
			(artifact) =>
				artifact.variant !== PlanningVocabulary.Artifact.Data &&
				parsePlan({ content: previous.artifacts.get(artifact.path) ?? '', base: artifact.path }).sections.has('Planning Provenance'),
		);
		if (authoring || established) {
			const rendered = runtime.services.render({ snapshot: { ...previous, record, artifacts }, artifacts, previous });
			const next = new Map(artifacts);
			for (const descriptor of record.artifacts.filter((item) => item.variant !== PlanningVocabulary.Artifact.Data)) {
				const content = rendered.get(descriptor.path);
				if (content === undefined) throw new Error(`Rendering omitted a canonical artifact: ${descriptor.path}`);
				descriptor.sha256 = sha256({ content });
				next.set(descriptor.path, content);
			}
			result = next;
		}
	}
	return result;
};
