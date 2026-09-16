import { describe, expect, test } from '@jest/globals';
import type { RunManifest } from '#src/contracts/index.ts';
import { validateRunHandoff } from '#src/runState/common/utils/validateRunHandoff.ts';

const setup = () => {
	const previous = {
		plan: 'plan.md',
		planningHandoff: { format: 'planning-handoff-v1', name: 'demo', generation: 'a'.repeat(64), phases: [] },
	} as unknown as RunManifest;
	return { previous };
};

describe('validateRunHandoff', () => {
	test('rejects removing frozen authority from an existing run', () => {
		const { previous } = setup();

		expect(() => validateRunHandoff({ previous, manifest: { ...previous, planningHandoff: undefined } })).toThrow('remove');
	});
	test('rejects changing the plan path beneath a frozen run', () => {
		const { previous } = setup();

		expect(() => validateRunHandoff({ previous, manifest: { ...previous, plan: 'other.md' } })).toThrow('plan or coordinator');
	});
});
