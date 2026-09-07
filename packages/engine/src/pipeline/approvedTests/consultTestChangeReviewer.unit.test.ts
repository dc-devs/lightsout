import { expect, test } from '@jest/globals';
import type { LightsoutConfig } from '#src/contracts/index.ts';
import type { Driver, DriverInvocation } from '#src/drivers/index.ts';
import { TestChangeKind } from '#src/pipeline/approvedTests/common/constants/TestChangeKind.ts';
import { consultTestChangeReviewer } from '#src/pipeline/approvedTests/consultTestChangeReviewer.ts';
import { outcomeFields } from '#tests/helpers/outcomeFields.ts';

/** A stub reviewer's final message: a valid TestChangeReview as bare JSON. */
const reviewText = JSON.stringify({
	verdicts: [
		{
			path: 'packages/engine/src/pipeline/steps/verifyStep.unit.test.ts',
			decision: 'approve',
			reason: 'the import is stale because the plan moved the module it names',
			acceptanceTests: [],
		},
	],
});

/**
 * A stub harness recording every invocation it receives, plus the minimum
 * config the reviewer reads (`gates` is required by the contract but never
 * consulted here). The overrides carry the widest permissions the config can
 * ask for and a supervisor timeout distinct from the agent one, so the
 * invocation's own posture is what the assertions read.
 */
const setupReviewer = ({ text = reviewText }: { text?: string } = {}) => {
	const invocations: DriverInvocation[] = [];

	const driver: Driver = {
		name: 'stub',
		invoke: async (invocation) => {
			invocations.push(invocation);

			return { text, exitCode: 0 };
		},
	};

	const config: LightsoutConfig = {
		gates: { check: 'true', test: 'true', 'test-coverage': 'true' },
		permissions: 'full-access',
		timeouts: { 'agent-minutes': 90, 'supervisor-minutes': 5 },
	};

	return {
		invocations,
		args: {
			driver,
			cwd: '/repo',
			config,
			planContent: 'PLAN-CONTENT',
			checkpoint: 'verify-implement',
			acceptanceTests: [
				{
					criterion: 'A refused review goes red without a gate run',
					testFile: 'packages/engine/src/pipeline/steps/verifyStep.unit.test.ts',
					testName: 'verifyStep: a refused review goes red',
					gate: 'test',
				},
			],
			changedFiles: ['packages/engine/src/pipeline/steps/verifyStep.ts'],
			changes: [
				{
					path: 'packages/engine/src/pipeline/steps/verifyStep.unit.test.ts',
					kind: TestChangeKind.Modified,
					diff: 'DIFF-BODY',
				},
			],
		},
	};
};

test('consultTestChangeReviewer: the reviewer runs read-only, on the supervisor timeout, against its own contract', async () => {
	const { invocations, args } = setupReviewer();

	const result = outcomeFields(await consultTestChangeReviewer(args));

	// the reviewer's posture is engine-owned — a full-access config never widens it
	expect(invocations[0].permissions).toBe('read-only');
	// five configured supervisor minutes, not the ninety agent ones
	expect(invocations[0].timeoutMs).toBe(300_000);
	// the verdict came back parsed, so the contract in force is TestChangeReview
	expect(result.report).toStrictEqual({
		verdicts: [
			{
				path: 'packages/engine/src/pipeline/steps/verifyStep.unit.test.ts',
				decision: 'approve',
				reason: 'the import is stale because the plan moved the module it names',
				acceptanceTests: [],
			},
		],
	});
});
