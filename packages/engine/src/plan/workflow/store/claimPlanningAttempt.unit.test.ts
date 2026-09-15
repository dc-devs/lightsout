import { rm } from 'node:fs/promises';
import { afterEach, describe, expect, test } from '@jest/globals';
import { PlanningVocabulary } from '#src/contracts/index.ts';
import { claimPlanningAttempt, commitPlanningSnapshot, readPlanningSnapshot } from '#src/plan/workflow/store/index.ts';
import { planningCompletedFixture } from '#tests/helpers/planningCompletedFixture.ts';

const directories: string[] = [];
afterEach(async () => {
	for (const cwd of directories.splice(0)) await rm(cwd, { recursive: true, force: true });
});
const setup = async ({ variant }: { variant: string }) => {
	const context = await planningCompletedFixture();
	directories.push(context.cwd);
	let snapshot = context.reviewing;
	const parameters = { runtime: context.runtime, workId: variant === 'completed' ? 'author' : 'reviewer', expectedInputDigest: context.origin.sha256 };
	if (variant === 'input') parameters.expectedInputDigest = 'a'.repeat(64);
	if (variant === 'unknown') parameters.workId = 'missing';
	if (variant === 'uninitialized') parameters.runtime = { ...context.runtime, name: 'not-imported' };
	if (variant === 'prerequisite') {
		const record = structuredClone(snapshot.record);
		record.revision++;
		record.parentDigest = snapshot.digest;
		record.work.push({
			...record.work[1],
			id: 'dependent',
			status: PlanningVocabulary.WorkState.Pending,
			currentAttemptId: undefined,
			attemptSequence: 0,
			prerequisiteIds: ['reviewer'],
		});
		const committed = await commitPlanningSnapshot({
			cwd: context.cwd,
			name: context.name,
			record,
			artifacts: snapshot.artifacts,
			expectedRevision: snapshot.record.revision,
			parentDigest: snapshot.digest,
		});
		if (!committed.committed) throw new Error('Fixture writer lost');
		snapshot = committed.snapshot;
		parameters.workId = 'dependent';
	}
	return { ...context, parameters, snapshot };
};

describe('claimPlanningAttempt', () => {
	test.each(['completed', 'input', 'prerequisite'])('does not claim work that is ineligible: %s', async (variant) => {
		const { cwd, name, parameters, snapshot } = await setup({ variant });

		const result = await claimPlanningAttempt(parameters);

		expect(result).toStrictEqual({ claimed: false, snapshot });
		expect(await readPlanningSnapshot({ cwd, name })).toStrictEqual(snapshot);
	});
	test.each([
		['unknown', 'Unknown planning work'],
		['uninitialized', 'Planning work cannot be claimed before its snapshot exists'],
	])('rejects absent work: %s', async (variant, message) => {
		const { parameters } = await setup({ variant });

		await expect(claimPlanningAttempt(parameters)).rejects.toThrow(message);
	});
});
