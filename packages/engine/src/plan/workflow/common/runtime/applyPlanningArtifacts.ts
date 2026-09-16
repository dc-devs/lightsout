import { canonicalJson } from '#src/common/utils/canonicalJson.ts';
import { sha256 } from '#src/common/utils/sha256.ts';
import { type PlanningArtifact, type PlanningRecord, type PlanningRoleResult, PlanningVocabulary } from '#src/contracts/index.ts';
import { planningScopeContains } from '#src/plan/workflow/common/utils/planningScopeContains.ts';
import { selectWritablePlanningArtifacts } from '#src/plan/workflow/common/utils/selectWritablePlanningArtifacts.ts';

interface Params {
	record: PlanningRecord;
	artifacts: Map<string, string>;
	result: PlanningRoleResult;
}

/** Enforce exact byte and descriptor bases; a stable phase rename is one atomic move with its replacement bytes. */
export const applyPlanningArtifacts = ({ record, artifacts, result }: Params): void => {
	const layouts = 'artifactLayouts' in result ? (result.artifactLayouts ?? []) : [];
	const edits = 'artifactEdits' in result ? result.artifactEdits : [];
	if (new Set(layouts.map((layout) => layout.path)).size !== layouts.length || new Set(edits.map((edit) => edit.path)).size !== edits.length)
		throw new Error('Duplicate artifact proposals');
	const before = [...record.artifacts];
	const work = record.work.find((item) => item.id === result.workId);
	if (!work) throw new Error('Artifact proposal has no assigned work');
	const writable = new Set(selectWritablePlanningArtifacts({ record, scope: work.scope }).map((artifact) => artifact.path));
	const allowed = ({ path }: { path: string }) => {
		if (!path.endsWith('.md') || path.startsWith('planning-') || path.startsWith('.')) throw new Error(`Role cannot edit reserved planning path: ${path}`);
	};
	for (const layout of layouts) {
		allowed({ path: layout.path });
		if (!planningScopeContains({ outer: work.scope, inner: layout.boundaries })) throw new Error('Artifact layout exceeds assignment scope');
		const target = before.find((artifact) => artifact.path === layout.path);
		const prior = target ?? (layout.phaseId ? before.find((artifact) => artifact.phaseId === layout.phaseId) : undefined);
		if (target?.variant === PlanningVocabulary.Artifact.Data) throw new Error('A role cannot replace engine data');
		if ((prior ? sha256({ content: canonicalJson({ value: prior }) }) : null) !== layout.baseDescriptorDigest)
			throw new Error(`Stale artifact layout: ${layout.path}`);
		if (target && target.phaseId !== layout.phaseId) throw new Error('A phase identity cannot change in place');
		if (prior && prior.path !== layout.path) {
			if (target || !edits.some((edit) => edit.path === layout.path) || edits.some((edit) => edit.path === prior.path))
				throw new Error('A phase move needs one unoccupied target and replacement bytes');
			record.artifacts = record.artifacts.filter((artifact) => artifact.path !== prior.path);
			artifacts.delete(prior.path);
			for (const finding of record.findings)
				finding.resolutionArtifacts = finding.resolutionArtifacts.map((path) => (path === prior.path ? layout.path : path));
		}
		const { baseDescriptorDigest: _base, ...descriptor } = layout;
		const content =
			artifacts.get(layout.path) ?? '# Pending implementation detail\n\nArchitecture boundaries are established; detailed authoring is still required.\n';
		const next: PlanningArtifact = { ...descriptor, sha256: sha256({ content }) };
		const previousIndex = prior ? before.findIndex((artifact) => artifact.path === prior.path) : -1;
		record.artifacts = record.artifacts.filter((artifact) => artifact.path !== layout.path);
		if (previousIndex >= 0) record.artifacts.splice(previousIndex, 0, next);
		else record.artifacts.push(next);
		artifacts.set(layout.path, content);
		if (!target && result.role !== PlanningVocabulary.Role.Architect && !edits.some((edit) => edit.path === layout.path))
			throw new Error('A new deliverable requires actual authored bytes');
	}
	for (const edit of edits) {
		allowed({ path: edit.path });
		if (work.scope.kind !== PlanningVocabulary.Scope.WholePlan && !writable.has(edit.path) && !layouts.some((layout) => layout.path === edit.path))
			throw new Error('Artifact edit exceeds assignment scope');
		const prior = before.find((artifact) => artifact.path === edit.path);
		if ((prior?.sha256 ?? null) !== edit.baseHash) throw new Error(`Stale artifact bytes: ${edit.path}`);
		const descriptor = record.artifacts.find((artifact) => artifact.path === edit.path);
		if (!descriptor || descriptor.variant === PlanningVocabulary.Artifact.Data) throw new Error('Artifact edits require an established authoring layout');
		descriptor.sha256 = sha256({ content: edit.content });
		artifacts.set(edit.path, edit.content);
	}
};
