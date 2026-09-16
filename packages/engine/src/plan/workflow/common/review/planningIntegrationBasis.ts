import { canonicalJson } from '#src/common/utils/canonicalJson.ts';
import { sha256 } from '#src/common/utils/sha256.ts';
import { PlanningVocabulary } from '#src/contracts/index.ts';
import { hasPlanningUncertainty } from '#src/plan/workflow/common/evidence/hasPlanningUncertainty.ts';
import { getCurrentPlanningReviews } from '#src/plan/workflow/common/review/getCurrentPlanningReviews.ts';
import type { PlanningSnapshot } from '#src/plan/workflow/common/types/PlanningSnapshot.ts';

interface Params {
	snapshot: PlanningSnapshot;
}

const ordered = <T>({ items }: { items: T[] }): T[] =>
	[...items].sort((left, right) => canonicalJson({ value: left }).localeCompare(canonicalJson({ value: right })));

/** Bind original intent and current detailed proof; accepting integration or updating diagnostics cannot change its own basis. */
export const planningIntegrationBasis = ({ snapshot }: Params): string => {
	const record = snapshot.record;
	const reviews = getCurrentPlanningReviews({ snapshot, stage: PlanningVocabulary.Stage.Implementation })
		.filter((receipt) => receipt.role !== PlanningVocabulary.Role.IntegrationReview)
		.map((receipt) => {
			const { completedAt: _time, ...proof } = receipt;
			return { ...proof, resultReceiptId: record.work.find((work) => work.id === receipt.workId)?.resultReceiptId };
		});
	const value = {
		executionPolicy: record.executionPolicies?.find((item) => item.stage === PlanningVocabulary.Stage.Implementation),
		sources: ordered({ items: record.sources.map(({ text: _text, ...source }) => source) }),
		claims: ordered({
			items: record.claims.map(({ origin, ...claim }) => ({ ...claim, origin: { artifact: origin.artifact, locator: origin.locator, sha256: origin.sha256 } })),
		}),
		confirmations: ordered({ items: record.confirmations }),
		legacySettlements: ordered({ items: record.legacySettlements ?? [] }),
		artifacts: ordered({
			items: record.artifacts
				.filter((artifact) => artifact.variant !== PlanningVocabulary.Artifact.Data)
				.map((artifact) => ({
					...artifact,
					actualDigest: snapshot.artifacts.has(artifact.path) ? sha256({ content: snapshot.artifacts.get(artifact.path) ?? '' }) : null,
				})),
		}),
		standards: ordered({ items: record.standards }),
		evidence: ordered({ items: record.evidence.filter((evidence) => evidence.conclusion !== '' || hasPlanningUncertainty({ evidence })) }),
		findings: ordered({
			items: record.findings.map(({ verificationReceiptIds: _receipts, state, ...finding }) => ({
				...finding,
				state: state === PlanningVocabulary.FindingState.Verified ? PlanningVocabulary.FindingState.Repairing : state,
			})),
		}),
		reviews: ordered({ items: reviews }),
	};
	return sha256({ content: canonicalJson({ value }) });
};
