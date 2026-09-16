import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { PlanningEvidence, PlanningRoleResult, PlanningVocabulary } from '#src/contracts/index.ts';
import { planningReviewFixture } from '#tests/helpers/planningReviewFixture.ts';

/** Actual architect-owned evidence with engine-observed source bytes and targeted reacquisition. */
export const planningArchitectEvidenceFixture = async () => {
	const fixture = await planningReviewFixture();
	const sourcePath = join(fixture.cwd, 'handler.ts');
	await writeFile(sourcePath, 'export const retention = "completed uploads";');
	const invoke = fixture.runtime.driver.invoke;
	fixture.runtime.driver = {
		...fixture.runtime.driver,
		invoke: async (invocation) => {
			const output = await invoke(invocation);
			const response = PlanningRoleResult.parse(JSON.parse(output.text));
			const packet = JSON.parse(invocation.prompt).context;
			if (response.kind !== PlanningVocabulary.ResultKind.Terminal || !('evidence' in response)) return output;
			if (response.role !== PlanningVocabulary.Role.Architect && !response.workId.startsWith('reinvestigate:')) return output;
			const observed = packet.evidence.find(
				(item: { evidence: { dependencyReach: string } }) => item.evidence.dependencyReach === PlanningVocabulary.DependencyReach.Known,
			);
			if (!observed)
				return {
					exitCode: 0,
					text: JSON.stringify({
						...JSON.parse(invocation.prompt).identity,
						kind: PlanningVocabulary.ResultKind.EvidenceRequest,
						requests: [
							{
								requestId: 'retention-source',
								operation: PlanningVocabulary.Operation.ReadFile,
								path: 'handler.ts',
								reason: 'Inspect the retention contract supporting the architectural conclusion.',
							},
						],
					}),
				};
			const acquired = PlanningEvidence.parse(observed.evidence);
			const targets =
				response.role === PlanningVocabulary.Role.Architect
					? [{ id: 'architect-retention' }]
					: (packet.incompleteEvidence ?? []).filter((item: { assignmentId: string }) => item.assignmentId === response.workId);
			return {
				...output,
				text: JSON.stringify({
					...response,
					evidence: targets.map(({ id }: { id: string }) => ({
						...acquired,
						id,
						claimIds: ['required'],
						conclusion: `Observed retention contract: ${observed.content}`,
						complete: true,
					})),
				}),
			};
		},
	};
	return { ...fixture, sourcePath };
};
