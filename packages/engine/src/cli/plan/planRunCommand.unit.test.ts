import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, jest, test } from '@jest/globals';
import { parseFlags } from '#src/cli/common/args/parseFlags.ts';
import type { resolveConfigAndDriver } from '#src/cli/common/utils/resolveConfigAndDriver.ts';
import { planAnswerCommand, planRunCommand } from '#src/cli/plan/index.ts';
import { sha256 } from '#src/common/utils/sha256.ts';
import { PlanningRunResult, PlanningVocabulary } from '#src/contracts/index.ts';
import { captureCommandOutput } from '#tests/helpers/captureCommandOutput.ts';
import { planningReviewFixture } from '#tests/helpers/planningReviewFixture.ts';

const mockResolve = jest.fn<typeof resolveConfigAndDriver>();
jest.mock('#src/cli/common/utils/resolveConfigAndDriver.ts', () => ({
	resolveConfigAndDriver: (params: Parameters<typeof resolveConfigAndDriver>[0]) => mockResolve(params),
}));

const setup = async ({ autoApprove = false }: { autoApprove?: boolean } = {}) => {
	const fixture = await planningReviewFixture();
	const output = captureCommandOutput();
	const config = { ...fixture.runtime.config, 'auto-plan': { 'auto-approve-plan': autoApprove, 'propose-before-draft': true } };
	mockResolve.mockResolvedValue({ config, driver: fixture.runtime.driver });
	await mkdir(join(fixture.cwd, '.lightsout'), { recursive: true });
	await writeFile(join(fixture.cwd, '.lightsout/input.json'), JSON.stringify(fixture.input));
	const context = {
		cwd: fixture.cwd,
		rest: [],
		flags: parseFlags({ args: ['--name', fixture.name, '--mode', 'automatic', '--input-file', '.lightsout/input.json'] }),
	};
	return { ...fixture, ...output, context, config };
};

describe('planRunCommand', () => {
	test('continues a durable proposal through the answer command without starting implementation', async () => {
		const fixture = await setup();
		await expect(planRunCommand(fixture.context)).rejects.toThrow('process.exit');
		const pending = PlanningRunResult.parse(JSON.parse(fixture.logged.at(-1) ?? 'null'));
		if (pending.status !== PlanningVocabulary.Status.AwaitingUser) throw new Error('Expected a proposal checkpoint');
		const answer = {
			questionId: pending.questionId,
			questionDigest: pending.questionDigest,
			checkpointRevision: pending.checkpointRevision,
			selectedOption: 'Approve proposal',
			confirmation: {
				...fixture.input.confirmations[0],
				id: 'cli-proposal-approval',
				messageId: 'cli-foreground-answer',
				messageText: 'Approve proposal',
				approvedDigest: sha256({ content: 'Approve proposal' }),
			},
		};
		await writeFile(join(fixture.cwd, '.lightsout/answer.json'), JSON.stringify(answer));

		await expect(
			planAnswerCommand({
				...fixture.context,
				flags: parseFlags({ args: ['--name', fixture.name, '--mode', 'automatic', '--answer-file', '.lightsout/answer.json'] }),
			}),
		).rejects.toThrow('process.exit');

		expect(fixture.exitCodes).toEqual([2, 0]);
		expect(PlanningRunResult.parse(JSON.parse(fixture.logged.at(-1) ?? 'null')).status).toBe(PlanningVocabulary.Status.Complete);
		expect(mockResolve).toHaveBeenCalledWith({ cwd: fixture.cwd, command: 'plan' });
		expect(fixture.calls.every((call) => call.prompt.includes('"role":'))).toBe(true);
	});

	test('finishes with configured automatic approval and emits a typed readiness result', async () => {
		const fixture = await setup({ autoApprove: true });

		await expect(planRunCommand(fixture.context)).rejects.toThrow('process.exit');

		expect(fixture.exitCodes).toEqual([0]);
		expect(PlanningRunResult.parse(JSON.parse(fixture.logged.at(-1) ?? 'null')).status).toBe(PlanningVocabulary.Status.Complete);
	});

	test('refuses missing repository configuration before dispatching any provider work', async () => {
		const fixture = await setup();
		mockResolve.mockResolvedValue({ config: undefined, driver: fixture.runtime.driver });

		const run = planRunCommand(fixture.context);

		await expect(run).rejects.toThrow('requires lightsout.config.json');
		expect(fixture.calls).toEqual([]);
	});

	test('rejects corrupt original input before any provider invocation', async () => {
		const fixture = await setup();
		await writeFile(
			join(fixture.cwd, '.lightsout/input.json'),
			JSON.stringify({ ...fixture.input, sources: [{ ...fixture.origin, text: 'changed without its hash' }] }),
		);

		const run = planRunCommand(fixture.context);

		await expect(run).rejects.toThrow('Source digest does not match original text');
		expect(fixture.calls).toEqual([]);
	});
});
