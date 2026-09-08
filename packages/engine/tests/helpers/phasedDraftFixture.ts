import { join } from 'node:path';
import type { DraftRole } from '#tests/helpers/createScriptedDraftDriver.ts';
import type { DeclarationSpec } from '#tests/helpers/phasePlan.ts';
import { seedPlanWorkspace } from '#tests/helpers/seedPlanWorkspace.ts';
import { setupConsumerRepo } from '#tests/helpers/setupConsumerRepo.ts';

/** One phase row, defaulted to the counts the clean phase body actually lands on. */
export const phaseRow = (overrides: Partial<DeclarationSpec> = {}): DeclarationSpec => ({
	number: 1,
	file: 'phase1-core.md',
	created: 1,
	touched: 2,
	...overrides,
});

/** A seeded plan workspace whose facts touch enough paths to estimate `overview`, plus the collectors the act writes into. */
export const setupPhasedDraft = ({ name, touching = 41, executorFileLimit }: { name: string; touching?: number; executorFileLimit?: number }) => {
	const cwd = setupConsumerRepo({ config: executorFileLimit === undefined ? undefined : { 'executor-file-limit': executorFileLimit } });

	seedPlanWorkspace({
		cwd,
		name,
		areas: [
			{
				area: 'core',
				filesToModify: Array.from({ length: touching }, (_, index) => ({ path: `src/mod${index}.ts`, role: 'touched' })),
				patternsToMirror: [],
				namingConvention: 'camelCase',
			},
		],
	});

	const calls: { role: DraftRole; file: string; prompt: string }[] = [];
	const messages: string[] = [];

	return { cwd, name, calls, messages, planDir: join(cwd, '.lightsout', 'plans', name), onProgress: (message: string) => messages.push(message) };
};
