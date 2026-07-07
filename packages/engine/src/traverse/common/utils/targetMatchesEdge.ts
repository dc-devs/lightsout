import type { ConnectionDoc } from '@lightsout/contracts';
import { collapseCasing } from '../../../common/naming/collapseCasing';

interface Params {
	/** The connection doc's edge id (its filename stem), source of the label key. */
	id: string;
	doc: ConnectionDoc;
	/** The already-normalized target the lead/exit names. */
	target: string;
}

/**
 * Does a plain (non-multiplexed) edge match a target? The edge's label (from
 * its id) and either anchor pattern are normalized into keys, and a match is
 * mutual containment between any key and the target. Shared by matchExitToEdge
 * and findConnectingDoc's plain-edge branch.
 */
export const targetMatchesEdge = ({ id, doc, target }: Params): boolean => {
	const label = id.split('--')[2] ?? '';
	const keys = [label, doc.fromAnchor?.pattern ?? '', doc.toAnchor?.pattern ?? ''].map(collapseCasing).filter(Boolean);

	return keys.some((key) => key.includes(target) || target.includes(key));
};
