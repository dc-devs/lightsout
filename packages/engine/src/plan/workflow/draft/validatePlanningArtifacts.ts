import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import { messageOf } from '#src/common/utils/messageOf.ts';
import { FindingSeverity, PlanningVocabulary, StructuralCheck, type StructuralFinding } from '#src/contracts/index.ts';
import { buildExportCensus, detectExportCollisions } from '#src/plan/evidence/index.ts';
import { lintPlanStructure } from '#src/plan/lint/index.ts';
import { parsePlan } from '#src/plan/parsePlan.ts';
import type { PlanningRuntime } from '#src/plan/workflow/common/types/PlanningRuntime.ts';
import type { PlanningSnapshot } from '#src/plan/workflow/common/types/PlanningSnapshot.ts';
import { orderPlanningPhases } from '#src/plan/workflow/common/utils/orderPlanningPhases.ts';
import { planningDecisionRecord } from '#src/plan/workflow/draft/common/utils/planningDecisionRecord.ts';
import { validatePlanningCoverage } from '#src/plan/workflow/draft/common/utils/validatePlanningCoverage.ts';
import { renderPlanningSections } from '#src/plan/workflow/draft/renderPlanningSections.ts';
import { PlanningResultReceipt, planningResultReceiptPath, validatePlanningRecord } from '#src/plan/workflow/store/index.ts';

interface Params {
	runtime: PlanningRuntime;
	snapshot: PlanningSnapshot;
	artifacts: ReadonlyMap<string, string>;
}

/** Stage the exact authored bytes for filesystem checks, then remove only this invocation's isolated directory. */
const lintAuthoredArtifacts = async ({
	runtime,
	snapshot,
	artifacts,
	deliverables,
}: Params & { deliverables: PlanningSnapshot['record']['artifacts'] }): Promise<StructuralFinding[]> => {
	const findings: StructuralFinding[] = [];
	const local = join(runtime.cwd, '.lightsout', 'plans', runtime.name, '.planning', 'local');
	await mkdir(local, { recursive: true });
	const staging = await mkdtemp(join(local, 'lint-'));
	try {
		const paths: string[] = [];
		for (const descriptor of deliverables) {
			const content = artifacts.get(descriptor.path);
			if (content === undefined) continue;
			const path = join(staging, descriptor.path);
			await mkdir(dirname(path), { recursive: true });
			await writeFile(path, content, { flag: 'wx' });
			paths.push(path);
		}
		const phases = orderPlanningPhases({ record: snapshot.record });
		findings.push(
			...(await lintPlanStructure({
				cwd: runtime.cwd,
				planPaths: paths,
				decisions: planningDecisionRecord({ snapshot }),
				config: { ...runtime.config, plan: { ...runtime.config.plan, contract: true } },
				canonicalPhases: phases.map((phase) => ({ file: basename(phase.path), id: phase.phaseId ?? '', prerequisiteIds: phase.prerequisiteIds })),
			})),
		);
		const census = await buildExportCensus({ cwd: runtime.cwd, config: runtime.config });
		for (const artifact of deliverables) {
			const plan = parsePlan({ content: artifacts.get(artifact.path) ?? '', base: basename(artifact.path) });
			const priorArt = (plan.sections.get('Prior Art') ?? []).join('\n');
			for (const collision of detectExportCollisions({ census, symbols: artifact.exports }))
				if (collision.collidesWith.some((entry) => !priorArt.includes(entry.path)))
					findings.push({
						check: StructuralCheck.DeclarationConsistent,
						severity: FindingSeverity.Blocking,
						phase: artifact.path,
						issue: `Export ${collision.symbol} has observed prior art: ${collision.collidesWith.map((entry) => entry.path).join(', ')}`,
						location: `${artifact.path} → Prior Art`,
						fix: 'Investigate and record the reuse or distinction decision against the observed paths; a name collision alone does not prove duplicate behavior.',
					});
		}
	} finally {
		await rm(staging, { recursive: true, force: true });
	}
	return findings;
};

/** Lint isolated exact artifacts with canonical ordering, source obligations, paths, scripts, sizes and observed prior-art names. */
export const validatePlanningArtifacts = async ({ runtime, snapshot, artifacts }: Params): Promise<StructuralFinding[]> => {
	const findings: StructuralFinding[] = [];
	const validation = validatePlanningRecord({ record: snapshot.record });
	if (!validation.valid) throw new Error(`Invalid planning graph: ${JSON.stringify(validation.issues)}`);
	const deliverables = snapshot.record.artifacts.filter((artifact) => artifact.variant !== PlanningVocabulary.Artifact.Data);
	const placeholder = '# Pending implementation detail\n\nArchitecture boundaries are established; detailed authoring is still required.\n';
	for (const descriptor of deliverables)
		if (!artifacts.has(descriptor.path))
			findings.push({
				check: StructuralCheck.SectionsPresent,
				severity: FindingSeverity.Blocking,
				phase: descriptor.path,
				issue: 'Missing required planning artifact bytes',
				location: descriptor.path,
				fix: 'Restore or author the complete declared artifact; an absent file cannot stand in for a pre-draft layout.',
			});
	// Only pre-draft layouts may bypass detailed lint. An accepted author cannot use the placeholder as a finished deliverable.
	const completedAuthoring = snapshot.record.work.some((work) => {
		if (work.status !== PlanningVocabulary.WorkState.Complete) return false;
		if (work.role === PlanningVocabulary.Role.Draft) return true;
		if (work.role !== PlanningVocabulary.Role.Repair) return false;
		const path = planningResultReceiptPath({ id: work.resultReceiptId ?? '' });
		const receipt = PlanningResultReceipt.parse(JSON.parse(snapshot.artifacts.get(path) ?? 'null'));
		return receipt.effects.artifacts.length > 0;
	});
	const authored = deliverables.some((artifact) => artifacts.get(artifact.path) !== placeholder && artifacts.has(artifact.path));
	if (deliverables.length > 0 && (authored || completedAuthoring)) {
		for (const descriptor of deliverables) {
			const content = artifacts.get(descriptor.path);
			const plan = parsePlan({ content: content ?? '', base: basename(descriptor.path) });
			if (content === undefined || (plan.duplicateSections?.length ?? 0) > 0 || plan.unterminatedFence)
				findings.push({
					check: StructuralCheck.SectionsPresent,
					severity: FindingSeverity.Blocking,
					phase: descriptor.path,
					issue: 'Missing artifact, duplicate sections or an unterminated fence require repair before regeneration',
					location: descriptor.path,
					fix: 'Retain the complete authored text while resolving ambiguous sections.',
				});
		}
		try {
			renderPlanningSections({ snapshot, artifacts });
		} catch (error) {
			findings.push({
				check: StructuralCheck.SectionsPresent,
				severity: FindingSeverity.Blocking,
				phase: 'overview.md',
				issue: `Section regeneration requires repair: ${messageOf({ error })}`,
				location: 'Engine-owned sections',
				fix: 'Represent all authored meaning in canonical claims before regenerating; do not discard the reported content.',
			});
		}
		findings.push(...validatePlanningCoverage({ snapshot, artifacts }));
		findings.push(...(await lintAuthoredArtifacts({ runtime, snapshot, artifacts, deliverables })));
	}
	return findings;
};
