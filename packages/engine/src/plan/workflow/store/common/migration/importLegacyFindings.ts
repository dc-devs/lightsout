import { z } from 'zod';
import { canonicalJson } from '#src/common/utils/canonicalJson.ts';
import { sha256 } from '#src/common/utils/sha256.ts';
import { GapOutcome, GradeFindingStatus, GradeMemory, type PlanningRecord, PlanningVocabulary } from '#src/contracts/index.ts';
import { planningDataArtifact } from '#src/plan/workflow/store/common/utils/planningDataArtifact.ts';

interface Params {
	record: PlanningRecord;
	artifacts: Map<string, string>;
	source?: { path: string; content: string };
}

/** Carry unresolved obligations and every original observation without manufacturing modern review adequacy. */
export const importLegacyFindings = ({ record, artifacts, source }: Params): void => {
	if (source === undefined) return;
	const parsed: unknown = JSON.parse(source.content);
	const memory = GradeMemory.parse(parsed);
	const originalRows = z.object({ findings: z.array(z.unknown()).optional() }).parse(parsed).findings ?? [];
	if (memory.planName !== record.planName) throw new Error('Legacy findings belong to a different plan');
	artifacts.set(source.path, source.content);
	if (!record.artifacts.some((item) => item.path === source.path)) record.artifacts.push(planningDataArtifact({ path: source.path, content: source.content }));
	for (const [index, finding] of memory.findings.entries()) {
		if (finding.status === GradeFindingStatus.Superseded) continue;
		const historicallyAnswered = finding.status === GradeFindingStatus.Resolved || finding.disposition === GapOutcome.AlreadyAnswered;
		const id = `legacy-finding:${finding.id}`;
		const rowText = canonicalJson({ value: originalRows[index] });
		const rowPath = `planning-legacy-findings/${sha256({ content: `${source.path}:${finding.id}:${rowText}` })}.json`;
		artifacts.set(rowPath, rowText);
		record.artifacts.push(planningDataArtifact({ path: rowPath, content: rowText }));
		const observations =
			finding.observations.length > 0
				? finding.observations.map(
						(observation, index) => `${source.path}:${finding.id}:observations[${index}]:${sha256({ content: JSON.stringify(observation) })}`,
					)
				: [`${source.path}:${finding.id}`];
		record.findings.push({
			id,
			observationIds: observations,
			scope: { kind: PlanningVocabulary.Scope.WholePlan, claimIds: [], phaseIds: [], packageRoots: [] },
			scenario: finding.gap,
			consequence: finding.sharedDefect ?? finding.gap,
			missingObligation: finding.decision,
			severity: PlanningVocabulary.Severity.Blocking,
			owner: PlanningVocabulary.Owner.Planner,
			state: historicallyAnswered ? PlanningVocabulary.FindingState.Repairing : PlanningVocabulary.FindingState.Open,
			proposedResolution:
				[
					finding.humanDecision,
					finding.agentDecision,
					finding.safeBecause,
					finding.answerAt,
					...finding.resolutions.map((resolution) => `${resolution.phase}: ${resolution.answerAt}`),
				]
					.filter(Boolean)
					.join('\n') || undefined,
			resolutionClaimIds: [],
			resolutionArtifacts: [],
			verificationReceiptIds: [],
			citations: [{ artifact: rowPath, quote: rowText, sha256: sha256({ content: rowText }) }],
		});
	}
};
