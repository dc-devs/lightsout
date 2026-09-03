import { describe, expect, test } from '@jest/globals';
import type { LightsoutConfig } from '#src/contracts/index.ts';
import { resolveLifecycleSettings } from '#src/ticketLifecycle/index.ts';

const configOf = (queue?: LightsoutConfig['queue']): LightsoutConfig => ({ gates: { check: 'true', test: 'true', 'test-coverage': false }, queue });

describe('resolveLifecycleSettings', () => {
	test('resolves with no queue block at all, because recording what a ticket owes needs no queue', () => {
		const lifecycle = resolveLifecycleSettings({ config: configOf() });

		expect(lifecycle).toStrictEqual({
			planningStatusLabels: {
				'planning-needs-brainstorm': 'planning-needs-brainstorm',
				'planning-needs-plan': 'planning-needs-plan',
				'planning-ready-auto-plan': 'planning-ready-auto-plan',
				'planning-complete': 'planning-complete',
				'planning-not-needed': 'planning-not-needed',
			},
			statusNames: { ready: 'Ready to implement', 'in-progress': 'In Progress', done: 'Done' },
			eligibleStatuses: ['Backlog', 'Ready to implement'],
		});
	});

	test('keeps the four labels a repository agrees with when it spells only one of them differently', () => {
		const lifecycle = resolveLifecycleSettings({
			config: configOf({ 'max-parallel': 2, 'planning-status-labels': { 'planning-ready-auto-plan': 'auto-plan-me' } }),
		});

		expect(lifecycle).toEqual(
			expect.objectContaining({
				planningStatusLabels: {
					'planning-needs-brainstorm': 'planning-needs-brainstorm',
					'planning-needs-plan': 'planning-needs-plan',
					'planning-ready-auto-plan': 'auto-plan-me',
					'planning-complete': 'planning-complete',
					'planning-not-needed': 'planning-not-needed',
				},
			}),
		);
	});

	test('turns each of the three status roles into the name the repository spells it with', () => {
		const lifecycle = resolveLifecycleSettings({
			config: configOf({ 'max-parallel': 2, 'ready-status': 'Waiting', 'in-progress-status': 'Building', 'done-status': 'Shipped' }),
		});

		expect(lifecycle).toEqual(expect.objectContaining({ statusNames: { ready: 'Waiting', 'in-progress': 'Building', done: 'Shipped' } }));
	});

	test('takes the eligible statuses the repository named, so the queue asks for exactly the ones it configured', () => {
		const lifecycle = resolveLifecycleSettings({ config: configOf({ 'max-parallel': 2, 'eligible-statuses': ['Todo', 'Waiting'] }) });

		expect(lifecycle).toEqual(expect.objectContaining({ eligibleStatuses: ['Todo', 'Waiting'] }));
	});

	test('refuses a label two planning statuses share, naming the label and both statuses it was configured onto', () => {
		const lifecycle = resolveLifecycleSettings({
			config: configOf({ 'max-parallel': 2, 'planning-status-labels': { 'planning-complete': 'shaped', 'planning-not-needed': 'shaped' } }),
		});

		expect(lifecycle).toStrictEqual({
			error: "`queue.planning-status-labels` maps 'shaped' to both planning-complete and planning-not-needed — one label cannot mean two planning statuses",
		});
	});

	test('refuses a spelling that collides with a default label the repository left alone, not only two spellings it wrote itself', () => {
		const lifecycle = resolveLifecycleSettings({
			config: configOf({ 'max-parallel': 2, 'planning-status-labels': { 'planning-needs-plan': 'planning-complete' } }),
		});

		expect(lifecycle).toStrictEqual({
			error:
				"`queue.planning-status-labels` maps 'planning-complete' to both planning-needs-plan and planning-complete — one label cannot mean two planning statuses",
		});
	});
});
