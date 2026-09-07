import { describe, expect, test } from '@jest/globals';
import { getAffectedPhases } from '#src/plan/common/scope/getAffectedPhases.ts';

/** A symmetric adjacency map, the shape `getPhaseConnections` returns: every edge is recorded on both of its phases. */
const setupConnections = ({ edges, isolated = [] }: { edges: [string, string][]; isolated?: string[] }) => {
	const connections = new Map<string, Set<string>>();

	const link = ({ from, to }: { from: string; to: string }): void => {
		const neighbours = connections.get(from) ?? new Set<string>();
		neighbours.add(to);
		connections.set(from, neighbours);
	};

	for (const [left, right] of edges) {
		link({ from: left, to: right });
		link({ from: right, to: left });
	}

	for (const base of isolated) {
		connections.set(base, connections.get(base) ?? new Set<string>());
	}

	return { connections };
};

describe('getAffectedPhases', () => {
	test('a changed shared contract pulls in the unchanged phase that consumes it', () => {
		// phase1 provides the shared contract, phase2 consumes it without its own text
		// changing, and phase3 shares nothing with either
		const { connections } = setupConnections({
			edges: [['phase1-contract.md', 'phase2-consumer.md']],
			isolated: ['phase3-unrelated.md'],
		});

		const affected = getAffectedPhases({ connections, edited: ['phase1-contract.md'] });

		expect(affected).toStrictEqual(['phase1-contract.md', 'phase2-consumer.md']);
	});

	test('the closure follows the chain past its first hop', () => {
		// phase1 changes the contract, phase2 re-exports it, and phase3 reads it
		// only from phase2
		const { connections } = setupConnections({
			edges: [
				['phase1-contract.md', 'phase2-relay.md'],
				['phase2-relay.md', 'phase3-consumer.md'],
			],
			isolated: ['phase4-unrelated.md'],
		});

		const affected = getAffectedPhases({ connections, edited: ['phase1-contract.md'] });

		// stopping at the first hop would leave phase3 unread while the pass
		// reported itself as covering the repair
		expect(affected).toStrictEqual(['phase1-contract.md', 'phase2-relay.md', 'phase3-consumer.md']);
	});

	test('an edited phase the graph does not know still comes back', () => {
		const { connections } = setupConnections({ edges: [['phase1-contract.md', 'phase2-consumer.md']] });

		const affected = getAffectedPhases({ connections, edited: ['phase9-unmapped.md'] });

		// a phase whose edges could not be read is read rather than skipped
		expect(affected).toStrictEqual(['phase9-unmapped.md']);
	});

	test('nothing edited reaches no phase at all', () => {
		const { connections } = setupConnections({ edges: [['phase1-contract.md', 'phase2-consumer.md']] });

		const affected = getAffectedPhases({ connections, edited: [] });

		// with no phase text changed there is no reader to spawn — only the
		// re-verification judges have work left
		expect(affected).toStrictEqual([]);
	});
});
