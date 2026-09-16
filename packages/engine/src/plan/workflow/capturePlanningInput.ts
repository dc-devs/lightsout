import { canonicalJson } from '#src/common/utils/canonicalJson.ts';
import { PlanningInput, type PlanningRecord, PlanningVocabulary } from '#src/contracts/index.ts';
import { archivePlanningBrainstorm } from '#src/plan/workflow/brainstorm/index.ts';
import { adoptPlanningExecutionPolicy } from '#src/plan/workflow/common/policy/adoptPlanningExecutionPolicy.ts';
import { resolvePlanningAlignment } from '#src/plan/workflow/common/review/resolvePlanningAlignment.ts';
import { updatePlanningSnapshot } from '#src/plan/workflow/common/runtime/updatePlanningSnapshot.ts';
import type { PlanningRuntime } from '#src/plan/workflow/common/types/PlanningRuntime.ts';
import type { PlanningSnapshot } from '#src/plan/workflow/common/types/PlanningSnapshot.ts';
import { applyPlanningInvalidation } from '#src/plan/workflow/common/utils/applyPlanningInvalidation.ts';
import { importPlanningWorkspace, initialPlanningWork, planningDataArtifact, readPlanningEntrySnapshot } from '#src/plan/workflow/store/index.ts';

interface Params {
	runtime: PlanningRuntime;
	input: PlanningInput;
	expectedGeneration?: string;
}

const invalidateCapturedInput = ({
	runtime,
	snapshot,
	record,
	artifacts,
	input,
}: {
	runtime: PlanningRuntime;
	snapshot: PlanningSnapshot;
	record: PlanningRecord;
	artifacts: Map<string, string>;
	input: PlanningInput;
}) => {
	const claimIds = record.claims
		.filter((claim) => canonicalJson({ value: claim }) !== canonicalJson({ value: snapshot.record.claims.find((prior) => prior.id === claim.id) }))
		.map((claim) => claim.id);
	const delta = {
		sourceChanged: canonicalJson({ value: record.sources }) !== canonicalJson({ value: snapshot.record.sources }),
		claimIds,
		evidenceIds: [],
		artifactPaths: [],
		boundaryPaths: [],
		findingIds: [],
		reviewReceiptIds: [],
		authorWorkId: 'foreground-input',
	};
	const invalidation = runtime.services.invalidate({
		snapshot: { ...snapshot, record, artifacts },
		changedDependencies: [],
		changedClaimIds: claimIds,
		delta,
	});
	const currentWork = record.work.filter((work) => work.stage === input.stage);
	// A foreground change must retire active dispatch authority even before its first baseline exists.
	// Prior-stage work remains immutable handoff history; its alignment binding is checked separately.
	applyPlanningInvalidation({
		record,
		invalidation: {
			...invalidation,
			workIds: currentWork
				.filter((work) => invalidation.workIds.includes(work.id) || work.status === PlanningVocabulary.WorkState.Running)
				.map((work) => work.id),
			receiptIds: invalidation.receiptIds.filter((id) =>
				record.reviewReceipts.some((receipt) => receipt.id === id && currentWork.some((work) => work.id === receipt.workId)),
			),
		},
	});
};

/** Capture original wording and foreground assertions before dispatch, retaining all earlier authority. */
export const capturePlanningInput = async ({ runtime, input: proposed, expectedGeneration }: Params): Promise<PlanningSnapshot> => {
	const input = PlanningInput.parse(proposed);
	if (input.stage !== runtime.stage) throw new Error('Planning input and runtime stages disagree');
	const imported =
		(await readPlanningEntrySnapshot({ cwd: runtime.cwd, name: runtime.name })) ??
		(await importPlanningWorkspace({ cwd: runtime.cwd, name: runtime.name, inputs: { input, artifacts: [] } }));
	await adoptPlanningExecutionPolicy({ runtime, snapshot: imported });
	return updatePlanningSnapshot({
		runtime,
		propose: async (snapshot) => {
			if (expectedGeneration !== undefined && snapshot.digest !== expectedGeneration)
				throw new Error('Planning changed before foreground input capture; re-enter with the current choices');
			const record = structuredClone(snapshot.record);
			const artifacts = new Map(snapshot.artifacts);
			archivePlanningBrainstorm({ snapshot, record, artifacts, stage: input.stage });
			let changed = false;
			for (const source of input.sources) {
				if (!record.sources.some((existing) => canonicalJson({ value: existing }) === canonicalJson({ value: source }))) {
					record.sources.push(source);
					changed = true;
				}
				const path = `planning-originals/${source.sha256}.txt`;
				if (!artifacts.has(path)) {
					artifacts.set(path, source.text);
					record.artifacts.push(planningDataArtifact({ path, content: source.text }));
				}
			}
			for (const confirmation of input.confirmations) {
				const previous = record.confirmations.find((item) => item.id === confirmation.id);
				if (previous && canonicalJson({ value: previous }) !== canonicalJson({ value: confirmation }))
					throw new Error('A foreground confirmation cannot be rewritten');
				if (!previous) record.confirmations.push(confirmation);
			}
			for (const claim of input.claims) {
				const previous = record.claims.find((item) => item.id === claim.id);
				if (previous && canonicalJson({ value: previous }) !== canonicalJson({ value: claim }))
					throw new Error('Changed input needs an explicit superseding claim and renewed confirmation');
				if (!previous) {
					record.claims.push(claim);
					changed = true;
				}
				if (claim.supersedes) {
					const old = record.claims.find((item) => item.id === claim.supersedes);
					if (!old) throw new Error('Superseding input references an unknown claim');
					if (claim.state !== PlanningVocabulary.ClaimState.Settled) throw new Error('Unconfirmed input cannot supersede approved meaning');
					old.state = PlanningVocabulary.ClaimState.Superseded;
					for (const dependent of record.claims)
						if (dependent.state !== PlanningVocabulary.ClaimState.Superseded)
							dependent.dependencies = dependent.dependencies.map((dependency) => (dependency === old.id ? claim.id : dependency));
				}
			}
			if (!record.work.some((work) => work.stage === input.stage)) {
				const initial = initialPlanningWork({ input });
				record.work.push(
					...initial.map((work) => ({ ...work, id: `${input.stage}:${work.id}`, prerequisiteIds: work.prerequisiteIds.map((id) => `${input.stage}:${id}`) })),
				);
			}
			if (changed) invalidateCapturedInput({ runtime, snapshot, record, artifacts, input });
			for (const confirmation of input.confirmations)
				if (confirmation.alignment && resolvePlanningAlignment({ snapshot: { ...snapshot, record, artifacts } })?.confirmationId !== confirmation.id)
					throw new Error('Foreground alignment does not bind the current independently challenged design');

			return { record, artifacts };
		},
	});
};
