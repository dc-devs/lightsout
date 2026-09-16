// Dependencies
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, jest, test } from '@jest/globals';
import { PlanningVocabulary } from '#src/contracts/index.ts';
import { createPlanningRuntime, readPlanningSnapshot } from '#src/plan/index.ts';
import { recordPlanningRelayAnswer } from '#src/queue/workers/recordPlanningRelayAnswer.ts';
import { runPlanningSession } from '#src/queue/workers/runPlanningSession.ts';
import { planningImportedResponse } from '#tests/helpers/planningImportedResponse.ts';
import { planningReviewFixture } from '#tests/helpers/planningReviewFixture.ts';
import { queueTicketFixture } from '#tests/helpers/queueTicketFixture.ts';

// Mocked Imports
// -------------------------
// Tracker mutation is outside this subject; real planning, readiness and immutable generations remain in process.
const mockRestoreTicketPlan = jest.fn<typeof import('#src/ticket/index.ts').restoreTicketPlan>();
const mockPublishTicketPlan = jest.fn<typeof import('#src/ticket/index.ts').publishTicketPlan>();
jest.mock('#src/ticket/index.ts', () => ({
	restoreTicketPlan: (params: Parameters<typeof mockRestoreTicketPlan>[0]) => mockRestoreTicketPlan(params),
	publishTicketPlan: (params: Parameters<typeof mockPublishTicketPlan>[0]) => mockPublishTicketPlan(params),
}));
// -------------------------

const setup = async ({
	proposal = false,
	planOnly = false,
	publishError = false,
	fresh = false,
	answered = false,
	restoreError = false,
}: {
	proposal?: boolean;
	planOnly?: boolean;
	publishError?: boolean;
	fresh?: boolean;
	answered?: boolean;
	restoreError?: boolean;
} = {}) => {
	const fixture = await planningReviewFixture({ name: 'lo-144-planning/001-retry', respond: planningImportedResponse });
	const config = {
		...fixture.runtime.config,
		'auto-plan': { 'auto-approve-plan': !proposal, 'propose-before-draft': false, 'implement-on-approval': !planOnly },
	};
	const runtime = await createPlanningRuntime({ ...fixture, config, driver: fixture.runtime.driver, mode: fixture.runtime.mode, stage: fixture.runtime.stage });
	Object.assign(fixture.runtime, runtime);
	if (!fresh) await fixture.capture();
	mockRestoreTicketPlan.mockImplementation(async () => {
		if (restoreError) return { error: 'Approved brainstorm generation is corrupt' };
		await mkdir(fixture.root, { recursive: true });
		await writeFile(join(fixture.root, 'brainstorm-notes.md'), fixture.input.sources[0].text);
		return { restored: ['brainstorm-notes.md'] };
	});
	mockPublishTicketPlan.mockResolvedValue({
		published: publishError ? [] : ['ticket.json'],
		stale: [],
		...(publishError ? { recordError: 'Tracker record update failed' } : {}),
	});
	const prepared = {
		...fixture,
		params: {
			cwd: fixture.cwd,
			planAddress: fixture.name,
			driver: runtime.driver,
			config,
			env: {},
			ticket: queueTicketFixture({ title: 'Preserve upload retries', description: 'Never discard already completed uploads.' }),
		},
	};
	if (answered) {
		const pending = await runPlanningSession(prepared.params);
		if (!pending?.planningQuestion) throw new Error('Fixture expected a real proposal checkpoint');
		const planningAnswer = await recordPlanningRelayAnswer({
			checkpoint: pending.planningQuestion,
			text: pending.planningQuestion.question.options[0].label,
			ticketRunDir: join(fixture.cwd, '.lightsout', 'queue-test'),
			coordinatorRunId: 'queue-test',
		});
		return { ...prepared, params: { ...prepared.params, planningAnswer } };
	}
	return prepared;
};

describe('runPlanningSession', () => {
	test('completes typed planning and publishes the exact generation before returning build authority', async () => {
		const fixture = await setup();

		const stopped = await runPlanningSession(fixture.params);

		const snapshot = await readPlanningSnapshot(fixture);
		expect(stopped).toBeUndefined();
		expect(mockPublishTicketPlan).toHaveBeenCalledWith(expect.objectContaining({ address: fixture.name, expectedGeneration: snapshot?.digest }));
		expect(fixture.calls.length).toBeGreaterThan(0);
		expect(fixture.calls.every((call) => !call.prompt.includes('headless auto-plan session'))).toBe(true);
	});

	test('returns an exact approval checkpoint without publishing or building', async () => {
		const fixture = await setup({ proposal: true });

		const stopped = await runPlanningSession(fixture.params);

		expect(stopped?.planningQuestion?.status).toBe(PlanningVocabulary.Status.AwaitingUser);
		expect(stopped?.question).toContain('exact option label');
		expect(mockPublishTicketPlan).not.toHaveBeenCalled();
	});

	test('keeps a fully published plan open when automatic implementation is disabled', async () => {
		const fixture = await setup({ planOnly: true });

		const stopped = await runPlanningSession(fixture.params);

		expect(stopped).toEqual({ open: expect.stringContaining('automatic implementation is disabled') });
		expect(mockPublishTicketPlan).toHaveBeenCalledTimes(1);
	});

	test('refuses build authority after tracker publication fails', async () => {
		const fixture = await setup({ publishError: true });

		const stopped = await runPlanningSession(fixture.params);

		expect(stopped).toEqual({ error: 'Tracker record update failed' });
	});
	test('restores approved notes before initial planning and retains ticket-only constraints', async () => {
		const fixture = await setup({ fresh: true });

		const stopped = await runPlanningSession(fixture.params);

		const snapshot = await readPlanningSnapshot(fixture);
		expect(stopped).toBeUndefined();
		expect(mockRestoreTicketPlan).toHaveBeenCalledWith(expect.objectContaining({ address: fixture.name, requireBrainstorm: true }));
		expect(snapshot?.record.sources.map((source) => source.artifact)).toEqual(expect.arrayContaining(['brainstorm-notes.md', 'ticket-body.txt']));
		expect(snapshot?.record.sources.find((source) => source.artifact === 'ticket-body.txt')?.text).toBe(
			'Preserve upload retries\n\nNever discard already completed uploads.',
		);
	});

	test('resumes from an actual relay approval and publishes without recapturing the ticket source', async () => {
		const fixture = await setup({ proposal: true, answered: true });

		const stopped = await runPlanningSession(fixture.params);

		const snapshot = await readPlanningSnapshot(fixture);
		expect(stopped).toBeUndefined();
		expect(mockPublishTicketPlan).toHaveBeenCalledTimes(1);
		expect(snapshot?.record.sources.filter((source) => source.artifact === 'ticket-body.txt')).toHaveLength(1);
	});

	test('refuses corrupt remote authority before any provider invocation or publication', async () => {
		const fixture = await setup({ fresh: true, restoreError: true });

		await expect(runPlanningSession(fixture.params)).rejects.toThrow('Approved brainstorm generation is corrupt');

		expect(fixture.calls).toEqual([]);
		expect(mockPublishTicketPlan).not.toHaveBeenCalled();
	});
});
