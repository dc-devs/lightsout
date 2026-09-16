import { symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { PlanningDependency, PlanningEvidence, PlanningVocabulary } from '#src/contracts/index.ts';
import { planningWorkflowFixture } from '#tests/helpers/planningWorkflowFixture.ts';

/** A real omitted symlink drives conservative assurance through the public Driver protocol. */
export const planningUnknownWorkflowFixture = async ({
	unavailable = false,
	stage = PlanningVocabulary.Stage.Brainstorm,
}: {
	unavailable?: boolean;
	stage?: (typeof PlanningVocabulary.Stage)[keyof typeof PlanningVocabulary.Stage];
} = {}) => {
	let requested = false;
	const assuranceCalls: string[] = [];
	const fixture = await planningWorkflowFixture({
		stage,
		respond: async ({ response, invocation, snapshot }) => {
			const packet = JSON.parse(invocation.prompt).context;
			if (response.role === PlanningVocabulary.Role.Investigate && !requested) {
				requested = true;
				return {
					kind: PlanningVocabulary.ResultKind.EvidenceRequest,
					role: response.role,
					workId: response.workId,
					attemptId: response.attemptId,
					inputDigest: response.inputDigest,
					invocationId: response.invocationId,
					packetDigest: response.packetDigest,
					requests: [
						{
							requestId: 'linked-handler',
							operation: PlanningVocabulary.Operation.List,
							root: '.',
							exclude: [],
							reason: 'Determine whether the linked adapter constrains product retention',
						},
					],
				};
			}
			if (response.role === PlanningVocabulary.Role.Investigate && response.kind === PlanningVocabulary.ResultKind.Terminal) {
				const observed = PlanningEvidence.parse(packet.evidence[0].evidence);
				return {
					...response,
					evidence: [
						{
							...observed,
							id: 'omitted-adapter',
							claimIds: ['required'],
							conclusion: 'The linked adapter was not inspected; the original product retention obligation remains binding.',
							complete: true,
						},
					],
				};
			}
			if (response.workId.startsWith('assurance:') && 'coverage' in response) {
				assuranceCalls.push(response.workId);
				const dependencies = PlanningDependency.array()
					.parse(packet.dependencies)
					.filter((dependency) => dependency.kind === PlanningVocabulary.Dependency.Unknown);
				const source = snapshot.record.sources[0];
				if (!source) throw new Error('Assurance requires original source evidence');
				return {
					...response,
					unknownAssessments: [
						{
							dependencyIds: dependencies.map((dependency) => dependency.id),
							claimIds: ['required'],
							outcome: unavailable ? PlanningVocabulary.UnknownAssessment.Unavailable : PlanningVocabulary.UnknownAssessment.Unnecessary,
							reason: unavailable
								? 'Adapter behavior is required before product alignment'
								: 'The quoted original product decision preserves completed uploads independently of the adapter implementation; technical investigation remains a planning obligation.',
							paths: unavailable ? ['linked-handler.ts'] : [],
							evidenceIds: [],
							citations: unavailable ? [] : [{ artifact: `planning-originals/${source.sha256}.txt`, quote: source.text, sha256: source.sha256 }],
						},
					],
				};
			}
			return response;
		},
	});
	await writeFile(join(fixture.cwd, 'target.ts'), 'export const hiddenAdapter = true;');
	await symlink('target.ts', join(fixture.cwd, 'linked-handler.ts'));
	await fixture.capture();
	return { ...fixture, assuranceCalls };
};
