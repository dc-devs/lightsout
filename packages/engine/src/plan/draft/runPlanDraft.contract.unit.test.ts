import { writeFileSync } from 'node:fs';
import { expect, test } from '@jest/globals';
import { PlanVariant } from '#src/contracts/index.ts';
import type { Driver } from '#src/drivers/index.ts';
import { runPlanDraft } from '#src/plan/draft/runPlanDraft.ts';
import { cleanPlanBody } from '#tests/helpers/cleanPlanBody.ts';
import { createDraftDriver } from '#tests/helpers/createDraftDriver.ts';
import { expectDefined } from '#tests/helpers/expectDefined.ts';
import { expectStatus } from '#tests/helpers/expectStatus.ts';
import { overviewBody } from '#tests/helpers/phasePlan.ts';
import { seedPlanWorkspace } from '#tests/helpers/seedPlanWorkspace.ts';
import { setupConsumerRepo } from '#tests/helpers/setupConsumerRepo.ts';

// What `plan.contract` changes about a draft: which brief every writer spawn is
// handed, in both draft flows, and that a repository which never declared the
// key drafts exactly as it did before the key existed.

/** The clean single plan plus the ledger a contract repository's writer is briefed to add — one row for the file it creates. */
const contractPlanBody = () => `${cleanPlanBody()}
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
 * spawn writes the contract phase file its prompt names. Which stage it is in is
 * read off the brief the builder emitted, exactly as a real writer would.
 */
const phasedDraftDriver = ({ onCall }: { onCall: (prompt: string) => void }): Driver => ({
	name: 'stub',
	invoke: async ({ prompt }) => {
		onCall(prompt);

		const path = /- (\S+\.md)/.exec(prompt)?.[1];

		// the engine dictates one output path per spawn
		expectDefined(path);

		const phase = prompt.includes('## Phase authoring');
		// the declared counts are the ones the contract phase body actually lands on
		const row = { number: 1, file: 'phase1-core.md', scope: 'the core', created: 1, touched: 2 };

		writeFileSync(path, phase ? contractPlanBody() : overviewBody({ rows: [row] }));

		return {
			text: JSON.stringify({
				status: 'drafted',
				filesWritten: [{ path, variant: phase ? PlanVariant.Phase : PlanVariant.Overview, scope: phase ? 'the core' : 'phased' }],
				decisionsApplied: 0,
				assumptions: [],
				discrepancies: [],
			}),
			exitCode: 0,
		};
	},
});

/** A seeded plan workspace in a repository that writes contract plans or does not, plus the prompt collector the act writes into. */
const setupContractDraft = ({ contract, name, touching = 0 }: { contract: boolean; name: string; touching?: number }) => {
	const cwd = setupConsumerRepo({ config: contract ? { plan: { contract: true } } : undefined });

	seedPlanWorkspace({ cwd, name, areas: [areaTouching({ count: touching })] });

	const prompts: string[] = [];

	return { cwd, name, prompts, onCall: (prompt: string) => prompts.push(prompt) };
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
