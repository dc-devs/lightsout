import type { ConnectionDoc, HopReport } from '@lightsout/contracts';
import { collapseCasing } from '../common/naming/collapseCasing';

interface Params {
	exit: HopReport['exits'][number];
	/** The node the exit leaves (the hop's node). */
	node: string;
	edges: Map<string, ConnectionDoc>;
}

/**
 * Route a hop exit to connection docs, deterministically: candidates share
 * the exit's origin node and kind; a candidate matches when its edge label
 * (from the filename) or either anchor pattern and the exit's target contain
 * one another after normalization. Zero matches is a GAP, multiple matches
 * is ambiguity reported as a gap — never a guess (prototype decision T7).
 */
export const matchExitToEdge = ({ exit, node, edges }: Params) => {
	const target = collapseCasing(exit.target);

	if (!target) {
		return [];
	}

	const matches: string[] = [];

	for (const [id, doc] of edges) {
		if (doc.from !== node || doc.type !== exit.kind) {
			continue;
		}

		const label = id.split('--')[2] ?? '';
		const keys = [label, doc.fromAnchor?.pattern ?? '', doc.toAnchor?.pattern ?? ''].map(collapseCasing).filter(Boolean);

		if (keys.some((key) => key.includes(target) || target.includes(key))) {
			matches.push(id);
		}
	}

	return matches;
};
