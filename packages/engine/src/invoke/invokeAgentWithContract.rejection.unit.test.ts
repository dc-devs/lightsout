import { describe, expect, test } from '@jest/globals';
import { WorkReport } from '#src/contracts/index.ts';
import type { Driver, DriverResult } from '#src/drivers/index.ts';
import { invokeAgentWithContract } from '#src/invoke/invokeAgentWithContract.ts';
import { outcomeFields } from '#tests/helpers/outcomeFields.ts';
import { report } from '#tests/helpers/report.ts';

const roleInvocation = { systemPrompt: 'ROLE-SYSTEM-PROMPT', prompt: 'ROLE-PROMPT' };

/**
 * A final message that IS valid JSON but not a valid WorkReport — `summary`
 * must be a string. Distinct from prose with no JSON at all: the payload is
 * found, and the contract is what turns it down.
 */
const malformedReport = JSON.stringify({ status: 'complete', changedFiles: [], summary: 42, failures: [] });

/**
 * A driver answering with the given replies in order, plus a rejection sink
 * that records what it was handed. Both append to one `events` log, so a test
 * can assert the order the chokepoint ran them in.
 *
 * `rejectionSinkIsSlow` makes the sink finish on a later turn of the event
 * loop, which is what distinguishes "awaited" from "fired and forgotten".
 */
const setupRejection = ({ replies, rejectionSinkIsSlow = false }: { replies: DriverResult[]; rejectionSinkIsSlow?: boolean }) => {
	const prompts: string[] = [];
	const rejections: { text: string; attempt: number; validationError: string }[] = [];
	const events: string[] = [];

	const driver: Driver = {
		name: 'stub',
		invoke: async ({ prompt }) => {
			prompts.push(prompt);
			events.push(`invoked attempt ${prompts.length}`);

			return replies[prompts.length - 1];
		},
	};

	const onRejectedOutput = async (params: { text: string; attempt: number; validationError: string }) => {
		if (rejectionSinkIsSlow) {
			await new Promise((resolve) => setImmediate(resolve));
		}

		rejections.push(params);
		events.push(`persisted attempt ${params.attempt}`);
	};

	return { driver, prompts, rejections, events, onRejectedOutput };
};

describe('invokeAgentWithContract', () => {
	test('a payload that parses as JSON but violates the contract is rejected and recovered by the re-emit retry', async () => {
		const { driver, onRejectedOutput, rejections } = setupRejection({
			replies: [
				{ text: malformedReport, exitCode: 0 },
				{ text: report({ summary: 're-emitted' }), exitCode: 0 },
			],
		});

		const { report: parsed, failure } = outcomeFields(
			await invokeAgentWithContract({ driver, cwd: '.', invocation: roleInvocation, contract: WorkReport, onRejectedOutput }),
		);

		expect(failure).toBe(undefined);
		expect(parsed?.summary).toBe('re-emitted');
		expect(rejections[0].validationError).toMatch(/summary/);
	});

	test('the re-emit retry shows the agent the validation error, not just its own rejected text', async () => {
		const { driver, onRejectedOutput, prompts, rejections } = setupRejection({
			replies: [
				{ text: malformedReport, exitCode: 0 },
				{ text: report({ summary: 're-emitted' }), exitCode: 0 },
			],
		});

		const { failure } = outcomeFields(await invokeAgentWithContract({ driver, cwd: '.', invocation: roleInvocation, contract: WorkReport, onRejectedOutput }));

		expect(failure).toBe(undefined);
		expect(prompts[1].includes('# Validation error')).toBeTruthy();
		expect(prompts[1].includes(rejections[0].validationError)).toBeTruthy();
	});

	test('each rejection is handed the raw text of its own attempt', async () => {
		const { driver, onRejectedOutput, rejections } = setupRejection({
			replies: [
				{ text: 'prose from the first attempt', exitCode: 0 },
				{ text: 'prose from the second attempt', exitCode: 0 },
			],
		});

		const { report: parsed } = outcomeFields(
			await invokeAgentWithContract({ driver, cwd: '.', invocation: roleInvocation, contract: WorkReport, onRejectedOutput }),
		);

		expect(parsed).toBe(undefined);
		expect(rejections.map(({ text, attempt }) => ({ text, attempt }))).toStrictEqual([
			{ text: 'prose from the first attempt', attempt: 1 },
			{ text: 'prose from the second attempt', attempt: 2 },
		]);
	});

	test('the rejected message is persisted before the retry is spawned — evidence survives a crash mid-retry', async () => {
		const { driver, onRejectedOutput, events } = setupRejection({
			replies: [
				{ text: 'prose from the first attempt', exitCode: 0 },
				{ text: report({ summary: 're-emitted' }), exitCode: 0 },
			],
			rejectionSinkIsSlow: true,
		});

		const { report: parsed } = outcomeFields(
			await invokeAgentWithContract({ driver, cwd: '.', invocation: roleInvocation, contract: WorkReport, onRejectedOutput }),
		);

		expect(parsed?.summary).toBe('re-emitted');
		expect(events).toStrictEqual(['invoked attempt 1', 'persisted attempt 1', 'invoked attempt 2']);
	});

	test('the exhausted failure names the LAST attempt exit code — the retry state is what the operator debugs', async () => {
		const { driver } = setupRejection({
			replies: [
				{ text: 'prose from the first attempt', exitCode: 0 },
				{ text: 'prose from the second attempt', exitCode: 3 },
			],
		});

		const { report: parsed, failure } = outcomeFields(await invokeAgentWithContract({ driver, cwd: '.', invocation: roleInvocation, contract: WorkReport }));

		expect(parsed).toBe(undefined);
		expect(failure).toMatch(/^agent output did not match contract \(exit 3\): /);
	});
});
