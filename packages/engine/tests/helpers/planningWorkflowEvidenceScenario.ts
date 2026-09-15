import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { PlanningVocabulary } from '#src/contracts/index.ts';
import { planningWorkflowFixture } from '#tests/helpers/planningWorkflowFixture.ts';

export const planningEvidenceContinuationScenario = async () => {
	let requested = false;
	let available = false;
	const fixture = await planningWorkflowFixture({
		respond: async ({ response }) => {
			if (response.role === PlanningVocabulary.Role.Investigate) {
				if (!requested) {
					requested = true;
					return {
						kind: PlanningVocabulary.ResultKind.EvidenceRequest,
						role: response.role,
						workId: response.workId,
						attemptId: response.attemptId,
						inputDigest: response.inputDigest,
						...('invocationId' in response ? { invocationId: response.invocationId, packetDigest: response.packetDigest } : {}),
						requests: [
							{
								requestId: 'upload-handler',
								operation: PlanningVocabulary.Operation.ReadFile,
								path: 'handler.ts',
								reason: 'Find the actual upload retry contract.',
							},
						],
					};
				}
				if (!available) return { text: 'Rate limit after acquiring handler evidence', exitCode: 1, rateLimited: true };
			}
			return response;
		},
	});
	const content = 'export const retryUpload = () => "preserve-completed";\n';
	await writeFile(join(fixture.cwd, 'handler.ts'), content);
	return {
		...fixture,
		content,
		makeAvailable: () => {
			available = true;
		},
	};
};
