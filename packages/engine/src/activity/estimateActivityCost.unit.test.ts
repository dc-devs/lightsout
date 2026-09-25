import { describe, expect, test } from '@jest/globals';
import { estimateActivityCost } from '#src/activity/estimateActivityCost.ts';
import { ActivityLevelKind } from '#src/contracts/activity/ActivityLevelKind.ts';
import { ActivityMarkKind } from '#src/contracts/activity/ActivityMarkKind.ts';
import type { ActivityNode } from '#src/contracts/activity/ActivityNode.ts';
import type { HarnessProcessMark } from '#src/contracts/activity/HarnessProcessMark.ts';
import type { HarnessProcessUsage } from '#src/contracts/activity/HarnessProcessUsage.ts';
import { ProcessEndReason } from '#src/contracts/activity/ProcessEndReason.ts';
import type { ConfigPricing } from '#src/contracts/ConfigPricing.ts';

/** The fold's own figures, which the estimator never reads — present only because a node carries them. */
const noTotals = {
	agentMs: 0,
	busyMs: 0,
	peakProcesses: 0,
	processCount: 0,
	usage: {},
};

/** One harness process, carrying only what a case varies. */
const harnessProcess = ({ levelId, model, usage }: { levelId: string; model?: string; usage?: HarnessProcessUsage }): HarnessProcessMark => ({
	kind: ActivityMarkKind.HarnessProcess,
	levelId,
	harness: 'stub',
	model,
	spawn: 1,
	reemit: false,
	startedAt: '2026-09-17T00:00:00.000Z',
	endedAt: '2026-09-17T00:00:05.000Z',
	endReason: ProcessEndReason.Completed,
	usage,
});

/** One level of a folded tree, with whatever processes and children a case gives it. */
const activityNode = ({ id, processes = [], children = [] }: { id: string; processes?: HarnessProcessMark[]; children?: ActivityNode[] }): ActivityNode => ({
	id,
	level: ActivityLevelKind.Step,
	label: id,
	startedAt: '2026-09-17T00:00:00.000Z',
	endedAt: '2026-09-17T00:00:10.000Z',
	processes,
	totals: noTotals,
	children,
});

/** Published rates for the one model these cases run under, in dollars per million tokens. */
const setupPricedModel = (): { pricing: ConfigPricing } => ({
	pricing: {
		'stub-model': { input: 3, output: 15, 'cache-read': 0.3, 'cache-write': 3.75 },
	},
});

/** A command run with one process of its own and a step below it holding another, both on the priced model. */
const setupSubtreeOnOneModel = () => {
	const { pricing } = setupPricedModel();

	const node = activityNode({
		id: 'run-1',
		processes: [
			harnessProcess({
				levelId: 'run-1',
				model: 'stub-model',
				usage: { inputTokens: 1_000_000, outputTokens: 500_000, cacheReadTokens: 2_000_000, cacheCreationTokens: 400_000 },
			}),
		],
		children: [
			activityNode({
				id: 'step-1',
				processes: [
					harnessProcess({
						levelId: 'step-1',
						model: 'stub-model',
						usage: { inputTokens: 500_000, outputTokens: 100_000 },
					}),
				],
			}),
		],
	});

	return { node, pricing };
};

/** Every process ran under a model the price list says nothing about. */
const setupUnpricedModel = () => {
	const { pricing } = setupPricedModel();

	const node = activityNode({
		id: 'run-1',
		processes: [
			harnessProcess({
				levelId: 'run-1',
				model: 'some-other-model',
				usage: { inputTokens: 1_000_000, outputTokens: 500_000 },
			}),
		],
	});

	return { node, pricing };
};

/** Two processes on a priced model that recovered no token counts at all — the shape a killed process leaves. */
const setupSubtreeWithoutTokens = () => {
	const { pricing } = setupPricedModel();

	const node = activityNode({
		id: 'run-1',
		processes: [harnessProcess({ levelId: 'run-1', model: 'stub-model' })],
		children: [
			activityNode({
				id: 'step-1',
				processes: [harnessProcess({ levelId: 'step-1', model: 'stub-model', usage: {} })],
			}),
		],
	});

	return { node, pricing };
};

/** One priced process beside two that cannot be priced: one on an unnamed model, one that recorded no model at all. */
const setupMixedSubtree = () => {
	const { pricing } = setupPricedModel();

	const node = activityNode({
		id: 'run-1',
		processes: [
			harnessProcess({
				levelId: 'run-1',
				model: 'stub-model',
				usage: { inputTokens: 200_000, outputTokens: 40_000 },
			}),
			harnessProcess({
				levelId: 'run-1',
				usage: { inputTokens: 9_000_000, outputTokens: 9_000_000 },
			}),
		],
		children: [
			activityNode({
				id: 'step-1',
				processes: [
					harnessProcess({
						levelId: 'step-1',
						model: 'some-other-model',
						usage: { inputTokens: 9_000_000, outputTokens: 9_000_000 },
					}),
				],
			}),
		],
	});

	return { node, pricing };
};

describe('estimateActivityCost', () => {
	test('estimateActivityCost: prices every process in the subtree at the configured per-million rates', () => {
		const { node, pricing } = setupSubtreeOnOneModel();

		const estimate = estimateActivityCost({ node, pricing });

		expect(estimate).toBeCloseTo(15.6, 10);
	});

	test('estimateActivityCost: an unpriced model and an absent price list both answer undefined, never zero', () => {
		const { node, pricing } = setupUnpricedModel();

		const unpricedModel = estimateActivityCost({ node, pricing });
		const noPriceList = estimateActivityCost({ node });

		expect({ unpricedModel, noPriceList }).toEqual({ unpricedModel: undefined, noPriceList: undefined });
	});

	test('estimateActivityCost: a subtree that reported no tokens answers undefined', () => {
		const { node, pricing } = setupSubtreeWithoutTokens();

		const estimate = estimateActivityCost({ node, pricing });

		expect(estimate).toBeUndefined();
	});

	test('estimateActivityCost: a mix of priced and unpriced processes answers the priced part alone', () => {
		const { node, pricing } = setupMixedSubtree();

		const estimate = estimateActivityCost({ node, pricing });

		expect(estimate).toBeCloseTo(1.2, 10);
	});
});
