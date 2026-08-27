import { describe, expect, test } from '@jest/globals';
import { PipelineKind } from '@lightsout/engine/contracts';
import { getRunCommand } from '#src/features/runs/index.ts';

describe('getRunCommand', () => {
	test.each([
		{ pipeline: PipelineKind.Implement, expected: 'implement' },
		{ pipeline: PipelineKind.Refactor, expected: 'refactor' },
		{ pipeline: PipelineKind.Coverage, expected: 'coverage' },
		{ pipeline: PipelineKind.Phases, expected: 'implement · phased' },
	])('reads the $pipeline pipeline as the command "$expected"', ({ pipeline, expected }) => {
		const command = getRunCommand({ pipeline });

		expect(command).toBe(expected);
	});

	test('leaves a pipeline this app does not know reading as itself', () => {
		// the contract types `pipeline` as a plain string on purpose: a row
		// labelled with the raw word beats one labelled wrongly
		const command = getRunCommand({ pipeline: 'migrate' });

		expect(command).toBe('migrate');
	});
});
