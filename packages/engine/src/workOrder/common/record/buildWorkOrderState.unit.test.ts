import { describe, expect, test } from '@jest/globals';
import type { LightsoutConfig } from '#src/contracts/index.ts';
import { buildWorkOrderState } from '#src/workOrder/common/record/buildWorkOrderState.ts';

const setupConfig = (): { config: LightsoutConfig } => ({
	config: {
		gates: { check: 'true', test: 'true', 'test-coverage': false },
		plan: { 'default-work-order-mode': 'multiple-plan' },
	},
});

describe('buildWorkOrderState', () => {
	test('builds a work order state with no ticket reference', () => {
		const { config } = setupConfig();

		const state = buildWorkOrderState({ name: 'tidy-the-logs', branch: 'feature/tidy-the-logs', config });

		expect({ state, carriesTicketRef: Object.hasOwn(state, 'ticketRef') }).toStrictEqual({
			state: {
				schemaVersion: 1,
				// the label the folder carries, which holds no ticket id at all
				name: 'tidy-the-logs',
				// the branch the work implements on, never derived from the label
				branch: 'feature/tidy-the-logs',
				mode: 'multiple-plan',
				plans: [],
				history: [],
			},
			// not present as an undefined value either — the key is simply absent
			carriesTicketRef: false,
		});
	});
});
