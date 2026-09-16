import { canonicalJson } from '#src/common/utils/canonicalJson.ts';
import { sha256 } from '#src/common/utils/sha256.ts';
import { type PlanningDependency, type PlanningEvidence, PlanningVocabulary, type PlanningWork } from '#src/contracts/index.ts';
import { planningRoleBrief } from '#src/plan/workflow/common/constants/planningRoleBrief.ts';
import { planningCollectionDigests } from '#src/plan/workflow/common/evidence/planningCollectionDigests.ts';
import type { PlanningEvidenceContent } from '#src/plan/workflow/common/types/PlanningEvidenceContent.ts';
import type { PlanningPacket } from '#src/plan/workflow/common/types/PlanningPacket.ts';
import type { PlanningSnapshot } from '#src/plan/workflow/common/types/PlanningSnapshot.ts';
import type { PlanningStandards } from '#src/plan/workflow/common/types/PlanningStandards.ts';
import { planningScopesIntersect } from '#src/plan/workflow/common/utils/planningScopesIntersect.ts';
import { readCommittedPlanningStandards } from '#src/plan/workflow/common/utils/readCommittedPlanningStandards.ts';
import { selectPlanningArtifacts } from '#src/plan/workflow/common/utils/selectPlanningArtifacts.ts';
import { selectPlanningClaims } from '#src/plan/workflow/common/utils/selectPlanningClaims.ts';
import { selectPlanningEvidence } from '#src/plan/workflow/common/utils/selectPlanningEvidence.ts';

/** Bind every supplied observation and semantic collection, refusing conflicting source versions. */
const buildPlanningPacketDependencies = ({
	snapshot,
	work,
	standards,
	conclusions,
	evidence,
}: {
	snapshot: PlanningSnapshot;
	work: PlanningWork;
	standards: PlanningStandards;
	conclusions: PlanningEvidence[];
	evidence: PlanningEvidenceContent[];
}): PlanningDependency[] => {
	const dependencies = new Map<string, PlanningDependency>();
	for (const dependency of [
		...standards.dependencies,
		...conclusions.flatMap((item) => item.dependencies),
		...evidence.flatMap((item) => item.evidence.dependencies),
	]) {
		const previous = dependencies.get(dependency.id);
		if (previous !== undefined && canonicalJson({ value: previous }) !== canonicalJson({ value: dependency }))
			throw new Error(`Conflicting planning evidence for ${dependency.id}`);
		dependencies.set(dependency.id, dependency);
	}
	for (const collection of [PlanningVocabulary.Collection.Claims, PlanningVocabulary.Collection.Phases, PlanningVocabulary.Collection.Exports]) {
		const dependency: Extract<PlanningDependency, { kind: typeof PlanningVocabulary.Dependency.Collection }> = {
			id: `collection:${collection}:${sha256({ content: canonicalJson({ value: work.scope }) })}`,
			kind: PlanningVocabulary.Dependency.Collection,
			collection,
			scope: canonicalJson({ value: work.scope }),
			memberDigests: {},
		};
		dependencies.set(dependency.id, { ...dependency, memberDigests: planningCollectionDigests({ record: snapshot.record, dependency }) });
	}
	return [...dependencies.values()];
};

interface Params {
	snapshot: PlanningSnapshot;
	work: PlanningWork;
	standards: PlanningStandards;
	evidence: PlanningEvidenceContent[];
}

/** Build a sufficient role packet from committed semantics, with explicit requests for any further needed evidence. */
export const buildPlanningPacket = ({ snapshot, work, standards, evidence }: Params): PlanningPacket => {
	const committed = readCommittedPlanningStandards({ snapshot });
	if (committed.policyDigest !== standards.policyDigest || canonicalJson({ value: committed.channels }) !== canonicalJson({ value: standards.channels }))
		throw new Error('Resolved standards must be committed before building a planning packet');
	const claims = selectPlanningClaims({ record: snapshot.record, work });
	const ids = new Set(claims.flatMap((claim) => [claim.id, ...claim.dependencies]));
	const recordedConclusions = selectPlanningEvidence({ record: snapshot.record, work });
	const unavailable = recordedConclusions.filter((item) => !item.complete);
	const conclusions = recordedConclusions.filter((item) => item.complete);
	if (
		unavailable.length > 0 &&
		!(
			work.role === PlanningVocabulary.Role.Diagnose ||
			(work.role === PlanningVocabulary.Role.Investigate && work.status === PlanningVocabulary.WorkState.Running && work.currentAttemptId)
		)
	)
		throw new Error(`Planning packet requires investigation of incomplete evidence: ${unavailable.map((item) => item.id).join(', ')}`);
	const selectedArtifacts = selectPlanningArtifacts({ record: snapshot.record, scope: work.scope, claimIds: claims.map((claim) => claim.id) }).filter(
		(artifact) => artifact.variant !== PlanningVocabulary.Artifact.Data,
	);
	const needsDeliverables = ![PlanningVocabulary.Role.Investigate, PlanningVocabulary.Role.Architect].some((role) => role === work.role);
	const artifacts = selectedArtifacts.map((artifact) => {
		const text = snapshot.artifacts.get(artifact.path);
		if (text === undefined || sha256({ content: text }) !== artifact.sha256) throw new Error(`Planning context is missing committed artifact ${artifact.path}`);
		return { descriptor: artifact, descriptorDigest: sha256({ content: canonicalJson({ value: artifact }) }), ...(needsDeliverables ? { content: text } : {}) };
	});
	const dependencies = buildPlanningPacketDependencies({ snapshot, work, standards, conclusions, evidence });
	const classifiedSources = new Set(
		snapshot.record.claims.filter((claim) => claim.state !== PlanningVocabulary.ClaimState.Superseded).map((claim) => canonicalJson({ value: claim.origin })),
	);
	const sources = [
		...new Map(
			[...claims.map((claim) => claim.origin), ...snapshot.record.sources.filter((source) => !classifiedSources.has(canonicalJson({ value: source })))].map(
				(source) => [canonicalJson({ value: source }), source],
			),
		).values(),
	];
	const binding = {
		role: work.role,
		stage: work.stage,
		assignment: work.assignment,
		scope: work.scope,
		claims: claims.map((claim) => ({ ...claim, origin: { artifact: claim.origin.artifact, locator: claim.origin.locator, sha256: claim.origin.sha256 } })),
		sources,
		confirmations: snapshot.record.confirmations.filter((confirmation) => claims.some((claim) => claim.confirmationId === confirmation.id)),
		historicalSettlements: (snapshot.record.legacySettlements ?? []).filter((settlement) => claims.some((claim) => claim.legacySettlementId === settlement.id)),
		standards: committed.channels.map(({ text: _text, ...descriptor }) => descriptor),
		standardsPolicy: committed.policyDigest,
		conclusions,
		...(unavailable.length > 0 ? { incompleteEvidence: unavailable } : {}),
		evidence,
		artifacts,
		findings: snapshot.record.findings.filter(
			(finding) => planningScopesIntersect({ left: work.scope, right: finding.scope }) || finding.scope.claimIds.some((id) => ids.has(id)),
		),
		dependencies,
	};
	const inputDigest = sha256({ content: canonicalJson({ value: binding }) });
	const standardText = committed.channels.map((channel) => `# ${channel.channel} standards\n\n${channel.text}`).join('\n\n');
	const systemPrompt = `${standardText}\n\n${planningRoleBrief}`;
	return {
		inputDigest,
		systemPrompt,
		prompt: canonicalJson({ value: binding }),
		dependencies,
		allowedEvidenceOperations: Object.values(PlanningVocabulary.Operation),
		roleResultSchema: 'planning-role-result-v1',
	};
};
