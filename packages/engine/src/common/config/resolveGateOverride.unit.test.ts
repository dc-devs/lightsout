import { describe, expect, test } from '@jest/globals';
import { resolveGateOverride } from '#src/common/config/resolveGateOverride.ts';
import type { LightsoutConfig } from '#src/contracts/index.ts';

const setupOverrides = (): { overrides: LightsoutConfig['gate-overrides'] } => ({
	overrides: {
		'clean-slate': 'off',
		'verify-implement': ['check'],
		'verify-tests': ['check', 'test-coverage', 'test-e2e'],
	},
});

describe('resolveGateOverride', () => {
	test('resolveGateOverride: a checkpoint reads its own entry, and an unlisted one reads none', () => {
		const { overrides } = setupOverrides();

		const cleanSlate = resolveGateOverride({ overrides, checkpoint: 'clean-slate' });
		const verifyImplement = resolveGateOverride({ overrides, checkpoint: 'verify-implement' });
		const verifyTests = resolveGateOverride({ overrides, checkpoint: 'verify-tests' });
		const verifyRefactor = resolveGateOverride({ overrides, checkpoint: 'verify-refactor' });
		const withoutBlock = resolveGateOverride({ overrides: undefined, checkpoint: 'verify-tests' });

		expect({ cleanSlate, verifyImplement, verifyTests, verifyRefactor, withoutBlock }).toStrictEqual({
			cleanSlate: 'off',
			verifyImplement: ['check'],
			// a checkpoint reads its own list, in the order the config wrote it
			verifyTests: ['check', 'test-coverage', 'test-e2e'],
			// unlisted, so this checkpoint keeps the engine's default schedule
			verifyRefactor: undefined,
			// no block at all is the same answer for every checkpoint
			withoutBlock: undefined,
		});
	});
});
