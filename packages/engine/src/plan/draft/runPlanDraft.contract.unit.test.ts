import { expect, test } from '@jest/globals';
import type { Driver, DriverInvocation } from '#src/drivers/index.ts';
import { runPlanDraft } from '#src/plan/draft/runPlanDraft.ts';
import { cleanPlanBody } from '#tests/helpers/cleanPlanBody.ts';
import { createDraftDriver } from '#tests/helpers/createDraftDriver.ts';
import { createScriptedDraftDriver } from '#tests/helpers/createScriptedDraftDriver.ts';
import { expectDefined } from '#tests/helpers/expectDefined.ts';
import { expectStatus } from '#tests/helpers/expectStatus.ts';
import { phaseRow } from '#tests/helpers/phasedDraftFixture.ts';
import { overviewBody } from '#tests/helpers/phasePlan.ts';
import { planTemplateOf } from '#tests/helpers/planTemplateOf.ts';
import { recordingDriver } from '#tests/helpers/recordingDriver.ts';
import { seedPlanWorkspace } from '#tests/helpers/seedPlanWorkspace.ts';
import { setupConsumerRepo } from '#tests/helpers/setupConsumerRepo.ts';

// What `plan.contract` changes about a draft: which brief every writer spawn is
// handed, in both draft flows, and that a repository which never declared the
// key drafts exactly as it did before the key existed.

/** The clean single plan plus the ledger a contract repository's writer is briefed to add — one row for the file it creates. */
const contractPlanBody = ({ reference = false }: { reference?: boolean } = {}) => `${cleanPlanBody({ reference })}
## Acceptance Tests

| Criterion | Test file | Test name | Gate |
|---|---|---|---|
| newThing is re-exported | \`src/newThing.unit.test.ts\` | re-exports newThing | test |
`;

/** One explorer area touching `count` paths — what the scope estimate reads to choose the phased variant. */
const areaTouching = ({ count }: { count: number }) => ({
	area: 'core',
	filesToModify: Array.from({ length: count }, (_, index) => ({ path: `src/mod${index}.ts`, role: 'touched' })),
	patternsToMirror: [],
	namingConvention: 'camelCase',
});

/**
 * A phased writer stub: the overview spawn writes the overview, and each phase
 * spawn writes the contract phase file its prompt names — the contract bodies
 * being the one thing this file's draft differs by.
 */
const phasedDraftDriver = ({ onCall }: { onCall: (prompt: string) => void }): Driver =>
	createScriptedDraftDriver({
		onCall: ({ prompt }) => onCall(prompt),
		// the declared counts are the ones the contract phase body actually lands on
		respond: ({ role }) => (role === 'phase' ? contractPlanBody({ reference: true }) : overviewBody({ rows: [phaseRow()] })),
	});

/** A seeded plan workspace in a repository that writes contract plans or does not, plus the prompt collector the act writes into. */
const setupContractDraft = ({ contract, name, touching = 0 }: { contract: boolean; name: string; touching?: number }) => {
	const cwd = setupConsumerRepo({ config: contract ? { plan: { contract: true } } : undefined });

	seedPlanWorkspace({ cwd, name, areas: [areaTouching({ count: touching })] });

	const prompts: string[] = [];

	return { cwd, name, prompts, onCall: (prompt: string) => prompts.push(prompt) };
};

/** The phased contract draft of `setupContractDraft`, with every invocation recorded — the system prompt is where the template rides, and the prompt collector alone cannot see it. */
const setupTemplateDraft = ({ name }: { name: string }) => {
	const { cwd, onCall } = setupContractDraft({ contract: true, name, touching: 41 });
	const invocations: DriverInvocation[] = [];

	return { cwd, name, driver: recordingDriver({ driver: phasedDraftDriver({ onCall }), invocations }), invocations };
};

test('plan draft: a contract repository briefs its writer on the acceptance-test ledger', async () => {
	const { cwd, name, prompts, onCall } = setupContractDraft({ contract: true, name: 'contract-single' });

	const result = await runPlanDraft({ cwd, driver: createDraftDriver({ bodies: [contractPlanBody()], onCall }), name });

	expectStatus(result, 'complete');

	const writer = prompts.find((prompt) => prompt.includes('# Draft input'));

	expectDefined(writer);
	expect(writer.includes('## Acceptance-test ledger')).toBeTruthy();
	// and the ledger it was briefed to write answers the section the same switch
	// made required, so the draft converged without spending a repair round
	expect(prompts.length).toBe(1);
});

test('plan draft: a repository that never declared the key sees no ledger text in its draft', async () => {
	const { cwd, name, prompts, onCall } = setupContractDraft({ contract: false, name: 'no-contract' });

	const result = await runPlanDraft({ cwd, driver: createDraftDriver({ bodies: [cleanPlanBody()], onCall }), name });

	expectStatus(result, 'complete');
	// a plan body with no ledger at all is still clean, and no ledger text reached
	// the writer — the draft is what it was before the key existed
	expect(prompts[0]?.includes('Acceptance')).toBeFalsy();
});

test('plan draft: a contract repository briefs its overview and phase spawns from the same key', async () => {
	const { cwd, name, prompts, onCall } = setupContractDraft({ contract: true, name: 'contract-phased', touching: 41 });

	const result = await runPlanDraft({ cwd, driver: phasedDraftDriver({ onCall }), name });

	expectStatus(result, 'complete');
	// a phase file carries the ledger a single plan would, so the phase spawn is
	// briefed too — and from the config the overview spawn was briefed from,
	// rather than from a second copy of it
	expect(prompts.map((prompt) => prompt.includes('## Acceptance-test ledger'))).toStrictEqual([true, true]);
});

test('plan draft: a contract repository hands the contract template to its overview and phase spawns alike', async () => {
	const { cwd, name, driver, invocations } = setupTemplateDraft({ name: 'contract-template' });

	const result = await runPlanDraft({ cwd, driver, name });

	expectStatus(result, 'complete');

	const templates = invocations.filter(({ prompt }) => prompt.includes('# Draft input')).map((invocation) => planTemplateOf(invocation));

	// one config key chooses the template, so the overview spawn and the phase
	// spawn are handed the same text — and it is the contract shape, whose ledger
	// rule and required ledger sections the narrative template does not carry
	expect({
		writerSpawns: templates.length,
		distinctTemplates: new Set(templates).size,
		ledgerSections: templates.every((template) => template.includes('## Acceptance Tests') && template.includes('## Prose Files')),
		ledgerRule: templates.every((template) => template.includes('Acceptance tests named, not narrated.')),
	}).toStrictEqual({ writerSpawns: 2, distinctTemplates: 1, ledgerSections: true, ledgerRule: true });
});
