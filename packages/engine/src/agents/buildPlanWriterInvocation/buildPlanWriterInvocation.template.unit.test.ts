import { expect, test } from '@jest/globals';
import { planTemplateOf } from '#tests/helpers/planTemplateOf.ts';
import { ledgerBriefOf, writerInvocation } from '#tests/helpers/planWriterInputs.ts';

// Which template a spawn is handed, what each one still asks the writer for, and
// the self-lint section that runs the Decision Log sync ahead of the lint.

/** The role prompt alone, cut where the labelled template section begins. */
const rolePromptOf = (systemPrompt: string): string => systemPrompt.slice(0, systemPrompt.indexOf('\n\n---\n\n# Plan Template\n\n'));

/** How many times a template names the command that composes the Decision Log — once per variant. */
const syncMentions = (template: string): number => template.split('lightsout plan sync-decisions').length - 1;

test("a contract repository's system prompt carries the contract template, not the narrative one", () => {
	const contractTemplate = planTemplateOf(writerInvocation({ contract: true }));
	const narrativeTemplate = planTemplateOf(writerInvocation());

	// the two rules only the contract template states
	expect(contractTemplate).toMatch(/Behaviour lives in the ledger/i);
	expect(contractTemplate).toMatch(/A criterion is a testable sentence/i);
	// its ledger sections are required sections, not an "omit unless" option
	expect(contractTemplate.includes('## Acceptance Tests')).toBeTruthy();
	expect(contractTemplate.includes('## Prose Files')).toBeTruthy();
	expect(contractTemplate).not.toMatch(/omit this heading entirely unless the draft input/);
	// the narrative template carries neither skeleton and neither rule
	expect(narrativeTemplate.includes('## Acceptance Tests')).toBeFalsy();
	expect(narrativeTemplate.includes('## Prose Files')).toBeFalsy();
	expect(narrativeTemplate).not.toMatch(/Behaviour lives in the ledger/i);
});

test('the narrative template carries no ledger sections and no contract token', () => {
	const narrative = writerInvocation().systemPrompt;
	const contract = writerInvocation({ contract: true }).systemPrompt;

	const narrativeTemplate = planTemplateOf({ systemPrompt: narrative });

	// the ledger skeletons and the acceptance-tests rule live in the other template now
	expect(narrativeTemplate.includes('## Acceptance Tests')).toBeFalsy();
	expect(narrativeTemplate.includes('## Prose Files')).toBeFalsy();
	expect(narrativeTemplate.includes('- **Acceptance tests named, not narrated.**')).toBeFalsy();
	// and neither template carries the token that used to switch between them,
	// so no repository can be handed one still standing
	expect(narrative.includes('{{contractRule}}')).toBeFalsy();
	expect(contract.includes('{{contractRule}}')).toBeFalsy();
});

test('both templates hand the Decision Log to the engine instead of the writer', () => {
	const narrativeTemplate = planTemplateOf(writerInvocation());
	const contractTemplate = planTemplateOf(writerInvocation({ contract: true }));

	const tableSkeleton = '| # | Source | Decision / Question | Options Considered | Choice | Rationale |';

	// the section is still part of every plan
	expect(narrativeTemplate.includes('## Decision Log')).toBeTruthy();
	expect(contractTemplate.includes('## Decision Log')).toBeTruthy();
	// but no table is offered for a writer to fill
	expect(narrativeTemplate.includes(tableSkeleton)).toBeFalsy();
	expect(contractTemplate.includes(tableSkeleton)).toBeFalsy();
	// and all three variants — Single, Overview, Phase — name what composes it
	expect(syncMentions(narrativeTemplate)).toBeGreaterThanOrEqual(3);
	expect(syncMentions(contractTemplate)).toBeGreaterThanOrEqual(3);
});

test("the contract template's size tokens and documentation rule are substituted like the narrative one's", () => {
	const template = planTemplateOf(
		writerInvocation({
			limits: { executorFileLimit: 80, createdFileCeiling: 12 },
			docs: [{ path: 'README.md', covers: 'The product tour.' }],
			contract: true,
		}),
	);

	// the configured numbers reach the writer verbatim
	expect(template).toMatch(/CREATES at most\s+12 source files/);
	expect(template).toMatch(/Above 80 the plan is/);
	// every later occurrence of the ceiling too, not just the first
	expect(template.match(/fixed at\s+12\./g)?.length ?? 0).toBeGreaterThanOrEqual(2);
	// a declared repository sees its documentation rule in this template as well
	expect(template.includes('- **Documentation stated.**')).toBeTruthy();
	// and no token survives into what the agent reads
	expect(template.includes('{{')).toBeFalsy();
});

test('the self-lint section runs the sync command before the lint command', () => {
	const syncCommand = 'node /repo/plugin/dist/cli.mjs plan sync-decisions --name foo-endpoint --cwd /repo';
	const lintCommand = 'node /repo/plugin/dist/cli.mjs plan lint --name foo-endpoint --cwd /repo';

	const both = writerInvocation({ lintCommand, syncCommand }).prompt;
	const lintOnly = writerInvocation({ lintCommand }).prompt;

	// both commands land verbatim in code spans
	expect(both.includes(`\`${syncCommand}\``)).toBeTruthy();
	expect(both.includes(`\`${lintCommand}\``)).toBeTruthy();
	// the sync composes the engine-owned section, so it is named first
	expect(both.indexOf(syncCommand) < both.indexOf(lintCommand)).toBeTruthy();
	// and the section keeps its place before the closing report-contract reminder
	expect(both.indexOf('## Self-lint') < both.indexOf('one JSON PlanDraftReport object')).toBeTruthy();
	// a spawn granted no sync command gets the section it gets today
	expect(lintOnly.includes('sync-decisions')).toBeFalsy();
	expect(lintOnly.includes('It prints structural findings and exits 1 while any remain')).toBeTruthy();
});

test('the role prompt tells the writer the Decision Log is engine-composed and asks for no rows', () => {
	const role = rolePromptOf(writerInvocation().systemPrompt);

	// the log is the engine's to compose, from the same records the writer holds
	expect(role).toMatch(/Decision Log/);
	expect(role).toMatch(/composed by the engine/i);
	// so the writer is no longer asked to render a row's source into a column
	expect(role.includes("Render every row's `source` verbatim in the Decision Log's `Source` column")).toBeFalsy();
	// the Global Constraints authoring rule survives whole, including the prefix
	// that selects its rows and the last-row-wins supersession rule
	expect(role).toMatch(/Author `## Global Constraints`/);
	expect(role).toMatch(/`Global constraint:`/);
	expect(role).toMatch(/is the live decision/);
});

test('the ledger brief asks each criterion for its inputs, condition, result and failure case', () => {
	const prompt = writerInvocation({ contract: true }).prompt;

	// the brief alone, cut at the next section, so no match comes from a neighbour
	const ledger = ledgerBriefOf({ prompt });

	// what every criterion has to carry
	expect(ledger).toMatch(/inputs/i);
	expect(ledger).toMatch(/condition/i);
	expect(ledger).toMatch(/expected result/i);
	expect(ledger).toMatch(/failure case/i);
	// and what a file entry carries instead of restating a row's behaviour
	expect(ledger).toMatch(/signatures/i);
	expect(ledger).toMatch(/integration points/i);
	expect(ledger).toMatch(/never a second statement/i);
});

test("buildPlanWriterInvocation: the contract template's ledger sections ride the implementable variants and never the overview", () => {
	const template = planTemplateOf(writerInvocation({ contract: true }));

	// the four blocks a template is written in: its rules, then one skeleton per
	// variant, separated by a horizontal rule
	const [, single, overview, phase] = template.split('\n\n---\n\n');
	const acceptance = single.slice(single.indexOf('\n\n## Acceptance Tests\n\n'), single.indexOf('\n\n## Prose Files\n\n'));
	const prose = single.slice(single.indexOf('\n\n## Prose Files\n\n'), single.indexOf('\n\n## What Next Plan Expects\n\n'));

	expect({
		// the Single skeleton carries both headings as sections of its own
		singleCarriesTheLedger: single.includes('\n\n## Acceptance Tests\n\n'),
		singleCarriesProseFiles: single.includes('\n\n## Prose Files\n\n'),
		// required, not conditional — a contract repository always writes both, so
		// neither section offers the "omit the heading entirely" escape its
		// optional neighbours carry
		ledgerSectionOffersNoEscape: /omit/i.test(acceptance),
		proseSectionOffersNoEscape: /omit/i.test(prose),
		// the overview creates nothing, so a row written there would belong to no
		// executor — its skeleton carries neither section
		overviewCarriesTheLedger: overview.includes('## Acceptance Tests'),
		overviewCarriesProseFiles: overview.includes('## Prose Files'),
		// and the Phase skeleton claims both for every phase, in its adjustment list
		phaseRequiresBoth: /\*\*Acceptance Tests\*\* and \*\*Prose Files\*\* are required in every phase/.test(phase),
	}).toEqual({
		singleCarriesTheLedger: true,
		singleCarriesProseFiles: true,
		ledgerSectionOffersNoEscape: false,
		proseSectionOffersNoEscape: false,
		overviewCarriesTheLedger: false,
		overviewCarriesProseFiles: false,
		phaseRequiresBoth: true,
	});
});
