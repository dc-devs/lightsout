import { describe, expect, test } from '@jest/globals';
import { getInvalidatedPhases } from '#src/plan/common/scope/getInvalidatedPhases.ts';

interface SetupParams {
	/** The plan files whose coverage falls on their own account. */
	edited: string[];
	/** The current phase graph's edges; absent when the graph could not be built. */
	edges?: [string, string][];
	/** Phase basenames the current graph knows with no edge of their own. */
	isolated?: string[];
	/** Each plan file's neighbours as a standing coverage entry recorded them. */
	recorded?: [string, string[]][];
	/** Every plan-file basename the deliverable holds now. */
	phaseFiles: string[];
}

/** The current graph is symmetric, the shape `getPhaseConnections` returns: every edge is recorded on both of its phases. */
const setupInvalidation = ({ edited, edges, isolated = [], recorded = [], phaseFiles }: SetupParams) => {
	const built = new Map<string, Set<string>>();

	const link = ({ from, to }: { from: string; to: string }): void => {
		const neighbours = built.get(from) ?? new Set<string>();
		neighbours.add(to);
		built.set(from, neighbours);
	};

	for (const [left, right] of edges ?? []) {
		link({ from: left, to: right });
		link({ from: right, to: left });
	}

	for (const base of isolated) {
		built.set(base, built.get(base) ?? new Set<string>());
	}

	const connections = edges === undefined ? undefined : built;

	return { params: { edited, connections, recorded: new Map(recorded), phaseFiles } };
};

describe('getInvalidatedPhases', () => {
	test('the answer is the transitive closure, not the first hop', () => {
		// phase1 is repaired, phase2 is joined to it, and phase3 is joined only to phase2
		const { params } = setupInvalidation({
			edited: ['phase1-contract.md'],
			edges: [
				['phase1-contract.md', 'phase2-relay.md'],
				['phase2-relay.md', 'phase3-consumer.md'],
			],
			phaseFiles: ['phase1-contract.md', 'phase2-relay.md', 'phase3-consumer.md'],
		});

		const invalidated = getInvalidatedPhases(params);

		// stopping at the first hop would leave phase3 holding a stale reading
		expect(invalidated).toStrictEqual(['phase1-contract.md', 'phase2-relay.md', 'phase3-consumer.md']);
	});

	test('a neighbour the current graph lost is still reached through the recorded one', () => {
		// the repair deleted the coupling, so the current graph joins the two phases to
		// nothing while the standing entries still record each as the other's neighbour
		const { params } = setupInvalidation({
			edited: ['phase1-contract.md'],
			edges: [],
			isolated: ['phase1-contract.md', 'phase2-consumer.md'],
			recorded: [
				['phase1-contract.md', ['phase2-consumer.md']],
				['phase2-consumer.md', ['phase1-contract.md']],
			],
			phaseFiles: ['phase1-contract.md', 'phase2-consumer.md'],
		});

		const invalidated = getInvalidatedPhases(params);

		// deleting an edge must not also delete the reason to re-read the far side of it
		expect(invalidated).toStrictEqual(['phase1-contract.md', 'phase2-consumer.md']);
	});

	test('an absent graph invalidates every plan file', () => {
		const { params } = setupInvalidation({
			edited: ['phase1-contract.md'],
			phaseFiles: ['phase1-contract.md', 'phase2-consumer.md', 'phase3-unrelated.md'],
		});

		const invalidated = getInvalidatedPhases(params);

		// a reach the engine cannot place is a full review, never a narrower answer
		expect(invalidated).toStrictEqual(['phase1-contract.md', 'phase2-consumer.md', 'phase3-unrelated.md']);
	});

	test('a phase the plan no longer holds bridges reach without being named', () => {
		// a resplit deleted phase2, and the two phases it used to join each recorded it
		// as a neighbour before it went
		const { params } = setupInvalidation({
			edited: ['phase1-contract.md'],
			edges: [],
			isolated: ['phase1-contract.md', 'phase3-consumer.md'],
			recorded: [
				['phase1-contract.md', ['phase2-deleted.md']],
				['phase3-consumer.md', ['phase2-deleted.md']],
			],
			phaseFiles: ['phase1-contract.md', 'phase3-consumer.md'],
		});

		const invalidated = getInvalidatedPhases(params);

		// the deleted phase carries the reach across itself without ever being
		// reported as a file to read
		expect(invalidated).toStrictEqual(['phase1-contract.md', 'phase3-consumer.md']);
	});
});
