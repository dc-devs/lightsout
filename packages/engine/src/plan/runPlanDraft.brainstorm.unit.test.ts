import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from '@jest/globals';
import type { DriverInvocation } from '#src/drivers/index.ts';
import { runPlanDraft } from '#src/plan/index.ts';
import { cleanPlanBody } from '#tests/helpers/cleanPlanBody.ts';
import { createDraftDriver } from '#tests/helpers/createDraftDriver.ts';
import { expectDefined } from '#tests/helpers/expectDefined.ts';
import { expectStatus } from '#tests/helpers/expectStatus.ts';
import { getRejectionError } from '#tests/helpers/getRejectionError.ts';
import { seedPlanWorkspace } from '#tests/helpers/seedPlanWorkspace.ts';
import { setupConsumerRepo } from '#tests/helpers/setupConsumerRepo.ts';

// The /brainstorm hand-off: settled rows merge into the draft prompt ahead of
// the plan's own, ride the repair invocation by path, and are narrated either way.

/** One brainstorm-settled row, as `/brainstorm` writes it into brainstorm-decisions.json. */
const brainstormRow = {
	source: 'Brainstorm',
	question: 'which shape?',
	options: 'a / b',
	choice: 'a',
	rationale: 'settled during brainstorm',
	assumption: false,
};

/** One plan-owned Elicitation row, as the session writes it into decisions.json. */
const elicitationRow = { source: 'Elicitation', question: 'which route?', options: 'x / y', choice: 'x', rationale: 'shortest path', assumption: false };

/** The clean skeleton with a planted placeholder, so the structural lint forces one repair. */
const dirtyPlan = () => cleanPlanBody().replace('A new module exporting', 'TBD — a new module exporting');

test("plan draft: a seeded brainstorm record rides the draft prompt with its rows ahead of the plan's own", async () => {
	const cwd = setupConsumerRepo();

	seedPlanWorkspace({ cwd, name: 'handed-off', brainstormDecisions: { planName: 'handed-off', decisions: [brainstormRow] } });
	writeFileSync(join(cwd, '.lightsout', 'plans', 'handed-off', 'decisions.json'), JSON.stringify({ planName: 'handed-off', decisions: [elicitationRow] }));

	const prompts: string[] = [];
	const result = await runPlanDraft({
		cwd,
		driver: createDraftDriver({ bodies: [cleanPlanBody()], onCall: (prompt) => prompts.push(prompt) }),
		name: 'handed-off',
	});

	expectStatus(result, 'complete');

	const [draftPrompt] = prompts;

	// both rows reach the writer in one merged decisions record
	expect(draftPrompt.includes('"question": "which shape?"')).toBeTruthy();
	expect(draftPrompt.includes('"question": "which route?"')).toBeTruthy();
	// brainstorm rows were settled first, so they render first in the Decision Log
	expect(draftPrompt.indexOf('"source": "Brainstorm"') < draftPrompt.indexOf('"source": "Elicitation"')).toBeTruthy();
});

test("plan draft: no brainstorm file drafts from the plan's own rows exactly as today", async () => {
	const cwd = setupConsumerRepo();

	seedPlanWorkspace({ cwd, name: 'no-handoff' });
	writeFileSync(join(cwd, '.lightsout', 'plans', 'no-handoff', 'decisions.json'), JSON.stringify({ planName: 'no-handoff', decisions: [elicitationRow] }));

	const prompts: string[] = [];
	const result = await runPlanDraft({
		cwd,
		driver: createDraftDriver({ bodies: [cleanPlanBody()], onCall: (prompt) => prompts.push(prompt) }),
		name: 'no-handoff',
	});

	expectStatus(result, 'complete');

	const [draftPrompt] = prompts;

	// the plan's own rows still ride the prompt
	expect(draftPrompt.includes('"question": "which route?"')).toBeTruthy();
	// no brainstorm rows appear from nowhere
	expect(draftPrompt.includes('"source": "Brainstorm"')).toBeFalsy();
});

test('plan draft: a malformed brainstorm-decisions.json rejects the draft rather than dropping the rows', async () => {
	const cwd = setupConsumerRepo();

	// a row under a plan-dialogue origin violates the brainstorm contract
	seedPlanWorkspace({ cwd, name: 'bad-brainstorm', brainstormDecisions: { planName: 'bad-brainstorm', decisions: [elicitationRow] } });

	const error = await getRejectionError({
		promise: runPlanDraft({ cwd, driver: createDraftDriver({ bodies: [cleanPlanBody()] }), name: 'bad-brainstorm' }),
	});

	// settled decisions the engine cannot read are a hard error, never silently dropped
	expect(error.message).toMatch(/source/);
});

test('plan draft: a brainstorm hand-off rides the repair invocation as a reference path', async () => {
	const cwd = setupConsumerRepo();

	seedPlanWorkspace({ cwd, name: 'handoff-repair', brainstormDecisions: { planName: 'handoff-repair', decisions: [brainstormRow] } });

	const invocations: DriverInvocation[] = [];
	const driver = createDraftDriver({ bodies: [dirtyPlan(), cleanPlanBody()], onInvoke: (invocation) => invocations.push(invocation) });
	const result = await runPlanDraft({ cwd, driver, name: 'handoff-repair' });

	expectStatus(result, 'complete');

	const repairInvocation = invocations.find((invocation) => invocation.prompt.includes('# Repair input'));

	// the dirty author forced a repair
	expectDefined(repairInvocation);
	// the brainstorm reference is the workspace path — a rebuilt Global Constraints
	// section must draw on the rows settled during brainstorm
	expect(repairInvocation.prompt.includes(join(cwd, '.lightsout', 'plans', 'handoff-repair', 'brainstorm-decisions.json'))).toBeTruthy();
});

test('plan draft: progress narrates how many brainstorm decisions were carried in', async () => {
	const cwd = setupConsumerRepo();

	seedPlanWorkspace({ cwd, name: 'narrated-handoff', brainstormDecisions: { planName: 'narrated-handoff', decisions: [brainstormRow] } });

	const messages: string[] = [];
	const result = await runPlanDraft({
		cwd,
		driver: createDraftDriver({ bodies: [cleanPlanBody()] }),
		name: 'narrated-handoff',
		onProgress: (message) => messages.push(message),
	});

	expectStatus(result, 'complete');
	// one message either way, so a run never leaves the reader guessing whether a
	// hand-off was found
	expect(messages).toEqual(expect.arrayContaining([expect.stringMatching(/1 brainstorm decision/)]));
});

test('plan draft: progress narrates the no-brainstorm path rather than staying silent', async () => {
	const cwd = setupConsumerRepo();

	seedPlanWorkspace({ cwd, name: 'narrated-no-handoff' });

	const messages: string[] = [];
	const result = await runPlanDraft({
		cwd,
		driver: createDraftDriver({ bodies: [cleanPlanBody()] }),
		name: 'narrated-no-handoff',
		onProgress: (message) => messages.push(message),
	});

	expectStatus(result, 'complete');
	// the absence is narrated too, never silently skipped
	expect(messages).toEqual(expect.arrayContaining([expect.stringMatching(/no brainstorm decisions/)]));
});
