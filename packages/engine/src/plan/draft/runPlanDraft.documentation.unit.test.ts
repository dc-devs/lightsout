import { expect, test } from '@jest/globals';
import { runPlanDraft } from '#src/plan/draft/runPlanDraft.ts';
import { cleanPlanBody } from '#tests/helpers/cleanPlanBody.ts';
import { createDraftDriver } from '#tests/helpers/createDraftDriver.ts';
import { createPhasedDraftDriver } from '#tests/helpers/createPhasedDraftDriver.ts';
import { expectDefined } from '#tests/helpers/expectDefined.ts';
import { expectStatus } from '#tests/helpers/expectStatus.ts';
import { seedPlanWorkspace } from '#tests/helpers/seedPlanWorkspace.ts';
import { setupConsumerRepo } from '#tests/helpers/setupConsumerRepo.ts';

// What a repository's declared documentation surfaces reach: the single writer,
// the repairer that rebuilds after it, and both spawns of a phased draft.

/** One explorer area whose facts touch the given modify and mirror paths. */
const areaTouching = ({ modify = [], mirror = [] }: { modify?: string[]; mirror?: string[] }) => ({
	area: 'core',
	filesToModify: modify.map((path) => ({ path, role: 'touched' })),
	patternsToMirror: mirror.map((path) => ({ path, takeaway: 'shape' })),
	namingConvention: 'camelCase',
});

/** `count` distinct repo-relative paths for the scope estimate. */
const paths = (count: number) => Array.from({ length: count }, (_, index) => `src/mod${index}.ts`);

/** The one surface a declaring repository writes in the cases below. */
const declaredDocs = [{ path: 'docs/configuration.md', covers: 'Every configuration key.' }];

test('plan draft: a repository declaring documentation surfaces briefs the writer and the repairer alike', async () => {
	const cwd = setupConsumerRepo({ config: { docs: declaredDocs } });

	seedPlanWorkspace({ cwd, name: 'declared' });

	const prompts: string[] = [];
	// the first body omits the section the declared block makes required, so the
	// structural lint forces exactly one repair round
	const driver = createDraftDriver({
		bodies: [cleanPlanBody(), cleanPlanBody({ documentation: 'Nothing user-facing — no docs needed.' })],
		onCall: (prompt) => prompts.push(prompt),
	});
	const result = await runPlanDraft({ cwd, driver, name: 'declared' });

	expectStatus(result, 'complete');

	const writer = prompts.find((prompt) => prompt.includes('# Draft input'));
	const repairer = prompts.find((prompt) => prompt.includes('# Repair input'));

	expectDefined(writer);
	expectDefined(repairer);
	// the repair role forbids inventing a section's content, so an unbriefed
	// repairer would either break that rule or fail the draft
	expect(writer.includes('- `docs/configuration.md` — Every configuration key.')).toBeTruthy();
	expect(repairer.includes('- `docs/configuration.md` — Every configuration key.')).toBeTruthy();
});

test('plan draft: a declared repository briefs its overview and phase spawns on the same surfaces', async () => {
	const cwd = setupConsumerRepo({ config: { docs: declaredDocs } });

	seedPlanWorkspace({ cwd, name: 'declared-phased', areas: [areaTouching({ modify: paths(41) })] });

	const prompts: string[] = [];
	const driver = createPhasedDraftDriver({
		onCall: (prompt) => prompts.push(prompt),
		phaseBody: cleanPlanBody({ documentation: 'Nothing user-facing — no docs needed.', reference: true }),
	});
	const result = await runPlanDraft({ cwd, driver, name: 'declared-phased' });

	expectStatus(result, 'complete');
	// a phase file carries the claim a single plan would, so the phase spawn is
	// told what the repository declared — and the overview spawn is briefed from
	// the same config rather than from a second copy of it
	expect(prompts.map((prompt) => prompt.includes('- `docs/configuration.md` — Every configuration key.'))).toStrictEqual([true, true]);
});
