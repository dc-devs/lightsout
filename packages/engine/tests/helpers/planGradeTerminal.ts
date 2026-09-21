import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { GapArea } from '#src/contracts/index.ts';
import type { Driver } from '#src/drivers/index.ts';
import { captureCommandOutput } from '#tests/helpers/captureCommandOutput.ts';
import { cleanOverviewBody } from '#tests/helpers/cleanOverviewBody.ts';
import { cleanPlanBody } from '#tests/helpers/cleanPlanBody.ts';
import { createGapCheckDriver } from '#tests/helpers/createGapCheckDriver.ts';
import { setupConsumerRepo } from '#tests/helpers/setupConsumerRepo.ts';
import { writeEmptyDecisions } from '#tests/helpers/writeEmptyDecisions.ts';
import { writePlanDeliverable } from '#tests/helpers/writePlanDeliverable.ts';

/** The command's own output, with the progress printer's timestamped narration dropped. */
export const printedLines = ({ logged }: { logged: string[] }) => logged.filter((line) => !/^\[\+\d+:\d\d\]/.test(line));

/** The ruling the shared stub's judges return, so the decision the command prints is the judge's own. */
export const judgedDecision = 'what the plan should do here';

/** The planted reader finding most cases grade: one omitted decision with two options to choose among. */
export const storageChoiceGap = { area: GapArea.OmittedDecision, gap: 'no storage choice', decision: 'pick a store', options: ['sqlite', 'postgres'] };

/** A driver that meets the wall on its first spawn, so the pass records what it had rather than what it wanted. */
export const rateLimitedChecker: Driver = { name: 'stub', invoke: async () => ({ text: '', exitCode: 1, rateLimited: true }) };

// A real consumer repo with a real committed deliverable: the structural half of
// the grade is the deterministic lint, and only the gap half is stubbed.
export const setupGrade = ({
	body,
	gaps = [],
	verdict,
	git = false,
	config,
}: {
	body?: string;
	gaps?: unknown[];
	verdict?: Record<string, unknown>;
	git?: boolean;
	config?: Record<string, unknown>;
} = {}) => {
	const captured = captureCommandOutput();
	const cwd = setupConsumerRepo({ git, config });

	if (body !== undefined) {
		writePlanDeliverable({ cwd, name: 'demo', body });
	}

	return { cwd, name: 'demo', driver: createGapCheckDriver({ gaps, verdict }), ...captured };
};

// A phased deliverable — an overview plus two clean phase files — so the gaps
// the fan-out stamps carry two different plan files to group under.
export const setupPhasedGrade = ({ gaps }: { gaps: unknown[] }) => {
	const captured = captureCommandOutput();
	const cwd = setupConsumerRepo({ git: false });
	const dir = join(cwd, '.lightsout', 'tickets', 'demo', 'plans');

	const secondPhase = cleanPlanBody({ title: 'Phase 2', reference: true })
		.replace(/new-thing/g, 'other-thing')
		.replace(/newThing/g, 'otherThing');

	mkdirSync(dir, { recursive: true });
	writeFileSync(join(dir, 'overview.md'), cleanOverviewBody());
	writeFileSync(join(dir, 'phase1-core.md'), cleanPlanBody({ title: 'Phase 1', reference: true }));
	writeFileSync(join(dir, 'phase2-extra.md'), secondPhase);
	writeEmptyDecisions({ dir, name: 'demo' });

	return { cwd, name: 'demo', driver: createGapCheckDriver({ gaps }), ...captured };
};

// A contract repository whose plan names its acceptance tests — what makes the
// weighing run at all, and so the only setup whose grade prints a weight line.
export const setupWeighedGrade = ({ body }: { body: string }) =>
	setupGrade({
		config: { plan: { contract: true } },
		body: `${body}
## Acceptance Tests

| Criterion | Test file | Test name | Gate |
|---|---|---|---|
| newThing is re-exported | \`src/newThing.unit.test.ts\` | re-exports newThing | test |
`,
	});
