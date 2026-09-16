// Dependencies
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { sha256 } from '#src/common/utils/sha256.ts';
import { PlanningVocabulary } from '#src/contracts/index.ts';
import { exportPlanningGeneration, installPlanningGeneration, invokePlanningRole, PlanningLease, readPlanningSnapshot } from '#src/plan/index.ts';
import { freshCwd } from '#tests/helpers/freshCwd.ts';
import { planningClaimedWorkflowFixture } from '#tests/helpers/planningClaimedWorkflowFixture.ts';
import { planningWorkflowResponse } from '#tests/helpers/planningWorkflowResponse.ts';

export const planningImportedAttemptFixture = async () => {
	const fixture = await planningClaimedWorkflowFixture({
		respond: async ({ response, call }) =>
			call === 1
				? {
						kind: PlanningVocabulary.ResultKind.EvidenceRequest,
						role: response.role,
						workId: response.workId,
						attemptId: response.attemptId,
						inputDigest: response.inputDigest,
						invocationId: response.invocationId,
						packetDigest: response.packetDigest,
						requests: [{ requestId: 'adapter', operation: PlanningVocabulary.Operation.ReadFile, path: 'adapter.ts', reason: 'Read retry adapter' }],
					}
				: response,
	});
	await writeFile(join(fixture.cwd, 'adapter.ts'), 'export const previousAdapter = true;');
	await invokePlanningRole(fixture);
	const original = await readPlanningSnapshot(fixture);
	if (!original) throw new Error('Missing original running attempt');
	const text = exportPlanningGeneration({ snapshot: original }).get('planning-record.json');
	if (!text) throw new Error('Missing portable record');
	const cwd = await freshCwd();
	const root = join(cwd, '.lightsout', 'plans', fixture.name);
	await mkdir(root, { recursive: true });
	await installPlanningGeneration({ directory: root, name: fixture.name, text, expectedDigest: sha256({ content: text }) });
	await writeFile(join(cwd, 'adapter.ts'), 'export const restoredAdapter = true;');
	const prompts: string[] = [];
	const runtime = {
		...fixture.runtime,
		cwd,
		lease: new PlanningLease({ cwd, name: fixture.name }),
		driver: {
			name: fixture.runtime.driver.name,
			invoke: async (invocation: Parameters<typeof fixture.runtime.driver.invoke>[0]) => {
				prompts.push(invocation.prompt);
				const snapshot = await readPlanningSnapshot({ cwd, name: fixture.name });
				if (!snapshot) throw new Error('Missing restored invocation');
				return { exitCode: 0, text: JSON.stringify(planningWorkflowResponse({ invocation, snapshot })) };
			},
		},
	};
	return { fixture, cwd, root, name: fixture.name, original, runtime, prompts };
};
