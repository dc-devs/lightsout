import { buildPlanWriterInvocation } from '#src/agents/index.ts';
import type { DecisionsRecord, PlanFacts } from '#src/contracts/index.ts';

/** A minimal verified PlanFacts with distinctive values to spot in the prompt — no assertion on an assembled invocation varies with it. */
export const planFacts = (): PlanFacts => ({
	request: 'add a foo endpoint',
	areas: [],
	verification: { pathsChecked: 0, missingPaths: [], scriptsChecked: 0, missingScripts: [] },
	verifiedAt: '2026-07-09T00:00:00.000Z',
});

/** A one-row decisions record keyed by a distinctive plan name, so the assembled prompt is a realistic one. */
const planDecisions = (): DecisionsRecord => ({
	planName: 'foo-endpoint',
	decisions: [{ source: 'Elicitation', question: 'Which route?', options: 'a / b', choice: 'a', rationale: 'shortest path', assumption: false }],
});

/** The one dictated output path of a single-plan spawn. */
const singlePlanOutput = () => [{ path: '/repo/.lightsout/plans/foo/plan.md', variant: 'single' as const }];

/** The two engine-owned size numbers every spawn is assembled with. */
const planLimits = () => ({ executorFileLimit: 50, createdFileCeiling: 30 });

/** One single-plan spawn assembled from those inputs, with whatever a case varies laid over them. */
export const writerInvocation = (overrides: Partial<Parameters<typeof buildPlanWriterInvocation>[0]> = {}): ReturnType<typeof buildPlanWriterInvocation> =>
	buildPlanWriterInvocation({ facts: planFacts(), decisions: planDecisions(), outputs: singlePlanOutput(), limits: planLimits(), ...overrides });

/** The acceptance-test ledger brief alone, cut at the next section heading, so an assertion about it can never match a neighbouring section. */
export const ledgerBriefOf = ({ prompt }: { prompt: string }): string => {
	const start = prompt.indexOf('## Acceptance-test ledger');
	const end = prompt.indexOf('\n\n## ', start + 1);

	return prompt.slice(start, end === -1 ? undefined : end);
};
