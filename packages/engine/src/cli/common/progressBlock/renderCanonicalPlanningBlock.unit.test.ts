import { describe, expect, test } from '@jest/globals';
import { renderCanonicalPlanningBlock } from '#src/cli/common/progressBlock/renderCanonicalPlanningBlock.ts';
import { type PlanningCanonicalProgress, PlanningVocabulary, RunStatus } from '#src/contracts/index.ts';

/** The plan folder every case draws. */
const name = 'demo';

/** The one generation digest these cases share — the renderer never reads it, and a block still has to carry a real one. */
const generation = 'a'.repeat(64);

const projectionOf = (overrides: Partial<PlanningCanonicalProgress> = {}): PlanningCanonicalProgress => ({
	generation,
	work: [],
	blockers: [],
	usage: { calls: 0, unreported: 0 },
	...overrides,
});

const workOf = ({ id, role, status, attempts }: PlanningCanonicalProgress['work'][number]) => ({ id, role, status, attempts });

describe('renderCanonicalPlanningBlock', () => {
	test('says every missing diagnostic is unavailable rather than showing a zero', () => {
		const block = renderCanonicalPlanningBlock({ name, canonical: projectionOf() }).join('\n');

		expect(block).toContain(' reuse    unavailable');
		expect(block).toContain(' spend    unavailable — no planning call is recorded here');
		expect(block).toContain(' implementation  unavailable');
		expect(block).not.toMatch(/\$0\.00|0 token/);
		expect(block).toMatch(/ now {2}no work item is recorded yet$/);
	});

	test('a plan whose every recorded call reported nothing shows no figure at all', () => {
		const canonical = projectionOf({ usage: { calls: 3, unreported: 3 } });

		const block = renderCanonicalPlanningBlock({ name, canonical }).join('\n');

		expect(block).toContain(' spend    unavailable — none of 3 recorded call(s) reported usage');
		expect(block).not.toContain('$');
	});

	test('a fully reported spend names no unavailable calls', () => {
		const canonical = projectionOf({
			usage: { calls: 2, unreported: 0, totals: { inputTokens: 900, outputTokens: 100, cacheReadTokens: 0, cacheCreationTokens: 0, costUsd: 1.5 } },
		});

		const block = renderCanonicalPlanningBlock({ name, canonical }).join('\n');

		expect(block).toContain('$1.50 · 1000 token(s) over 2 of 2 call(s)');
		expect(block).not.toMatch(/usage unavailable/);
	});

	test('the now line names the next waiting item when nothing is running', () => {
		const canonical = projectionOf({
			work: [
				workOf({ id: 'author', role: PlanningVocabulary.Role.Investigate, status: RunStatus.Passed, attempts: 1 }),
				workOf({ id: 'next-look', role: PlanningVocabulary.Role.Architect, status: RunStatus.Pending, attempts: 0 }),
			],
		});

		const block = renderCanonicalPlanningBlock({ name, canonical });

		expect(block.at(-2)).toBe(' 1 of 2 work item(s) with a result · 0 blocking finding(s) open');
		expect(block.at(-1)).toBe(' now  architect:next-look not started');
	});

	test('with nothing left to run, an open blocking finding is what the now line names', () => {
		const canonical = projectionOf({
			work: [workOf({ id: 'author', role: PlanningVocabulary.Role.Investigate, status: RunStatus.Passed, attempts: 1 })],
			blockers: ['contract-drift — Recheck the changed contract'],
		});

		const block = renderCanonicalPlanningBlock({ name, canonical });

		expect(block).toContain(' blocked  contract-drift — Recheck the changed contract');
		expect(block.at(-1)).toBe(' now  held by 1 open blocking finding(s)');
	});

	test('with every item answered and nothing open, the now line still claims no readiness', () => {
		const canonical = projectionOf({
			work: [workOf({ id: 'author', role: PlanningVocabulary.Role.Investigate, status: RunStatus.Passed, attempts: 1 })],
			reuse: { savedConclusions: 2, repairedFindings: 0 },
			implementation: { runId: 'implement-demo', status: RunStatus.Passed },
		});

		const block = renderCanonicalPlanningBlock({ name, canonical }).join('\n');

		expect(block).toContain(' reuse    2 saved conclusion(s) · 0 finding(s) repaired and verified');
		expect(block).toContain(' implementation  run implement-demo passed');
		expect(block).toMatch(/ now {2}every recorded work item has a result$/);
		// readiness is the completion record's word, never this block's
		expect(block).not.toMatch(/planning complete|ready to implement/i);
	});
});
