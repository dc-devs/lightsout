import { basename } from 'node:path';
import { z } from 'zod';
import { canonicalJson } from '#src/common/utils/canonicalJson.ts';
import { sha256 } from '#src/common/utils/sha256.ts';
import { BrainstormDecisions, DecisionsRecord, type PlanningRecord, PlanningVocabulary } from '#src/contracts/index.ts';
import { legacyPlanningScope } from '#src/plan/workflow/store/common/migration/legacyPlanningScope.ts';
import { planningDataArtifact } from '#src/plan/workflow/store/common/utils/planningDataArtifact.ts';

interface Params {
	record: PlanningRecord;
	artifacts: Map<string, string>;
	sources: Array<{ path: string; content: string }>;
}

/** Preserve original rows, including absent legacy defaults, and retain assumptions as unresolved. */
export const importLegacyDecisions = ({ record, artifacts, sources }: Params): void => {
	for (const { path, content } of sources) {
		const parsed: unknown = JSON.parse(content);
		const raw = z.object({ decisions: z.array(z.unknown()).optional() }).parse(parsed);
		const legacy = path.endsWith('brainstorm-decisions.json') ? BrainstormDecisions.parse(parsed) : DecisionsRecord.parse(parsed);
		if (legacy.planName !== record.planName) throw new Error('Legacy decisions belong to a different plan');
		if (artifacts.has(path) && artifacts.get(path) !== content) throw new Error('Conflicting original legacy decision bytes');
		artifacts.set(path, content);
		if (!record.artifacts.some((item) => item.path === path)) record.artifacts.push(planningDataArtifact({ path, content }));
		const archivePath = `planning-originals/decisions-${sha256({ content: `${path}:${sha256({ content })}` })}.json`;
		artifacts.set(archivePath, content);
		record.artifacts.push(planningDataArtifact({ path: archivePath, content }));
		for (const [rowIndex, row] of legacy.decisions.entries()) {
			const rowText = canonicalJson({ value: raw.decisions?.[rowIndex] });
			const rowDigest = sha256({ content: rowText });
			const id = `legacy-decision:${sha256({ content: `${path}:${rowIndex}:${rowDigest}` })}`;
			const phaseBindings = (row.phases ?? []).map((phase) => ({
				name: phase,
				phaseId: record.artifacts.find((item) => item.variant === PlanningVocabulary.Artifact.Phase && basename(item.path) === phase)?.phaseId ?? null,
			}));
			const scope = legacyPlanningScope({ bindings: phaseBindings });
			const origin = { artifact: path, locator: `decisions[${rowIndex}]`, text: rowText, sha256: rowDigest };
			record.sources.push(origin);
			const settlementId = row.assumption ? undefined : `settlement:${id}`;
			record.claims.push({
				id,
				kind: PlanningVocabulary.ClaimKind.Decision,
				text: row.choice,
				explanation: row.assumption ? `${row.rationale}\nUnconfirmed legacy assumption: classify against explicit delegation before settling.` : row.rationale,
				contentRevision: 1,
				origin,
				owner: row.assumption ? PlanningVocabulary.Owner.Planner : PlanningVocabulary.Owner.User,
				state: row.assumption ? PlanningVocabulary.ClaimState.Unresolved : PlanningVocabulary.ClaimState.Settled,
				dependencies: [],
				scope,
				...(settlementId === undefined ? {} : { legacySettlementId: settlementId }),
			});
			if (settlementId !== undefined) {
				record.legacySettlements ??= [];
				record.legacySettlements.push({
					id: settlementId,
					format: 'legacy-decision-v1',
					planName: record.planName,
					claimId: id,
					sourcePath: path,
					artifact: archivePath,
					artifactDigest: sha256({ content }),
					rowIndex,
					rowText,
					rowDigest,
					choiceDigest: sha256({ content: row.choice }),
					scope,
					phaseBindings,
				});
			}
		}
	}
};
