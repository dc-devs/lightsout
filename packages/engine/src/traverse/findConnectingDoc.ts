import type { ConnectionDoc, DebugHopReport } from '@lightsout/contracts';
import { collapseCasing } from '../common/naming/collapseCasing';

interface Params {
	/** A debug lead: the crossing the hop agent saw in the current node's code (verdict = points-elsewhere). */
	lead: NonNullable<DebugHopReport['nextLead']>;
	/** The node the lead leaves from (the current hop's node). */
	node: string;
	edges: Map<string, ConnectionDoc>;
}

/**
 * Route a debug lead to connection doc(s), in the lead's direction — the
 * bidirectional counterpart to matchExitToEdge. `downstream` follows an
 * outbound crossing to its receiver (docs with `from === node`, entered at
 * the `to-anchor`); `upstream` follows the inbound crossing the bad data
 * arrived through back to its sender (docs with `to === node`, entered at the
 * `from-anchor`). Zero matches is a GAP, multiple is ambiguity — never a
 * guess (prototype decision T7). Each hit resolves the far node + the anchor
 * to enter it (undefined when the doc lacks that side's anchor — the caller
 * records a gap, as with a repo node missing its anchor).
 *
 * Matching is transport-aware: a plain edge matches on kind + normalized
 * target vs the edge label / anchor patterns. A MULTIPLEXED edge (one that
 * carries `operations` — GraphQL/tRPC/…) is a single transport channel, so a
 * lead naming an operation (`mutation UpdateProject …`, not the `/graphql`
 * path) still routes to it: match on kind + origin, disambiguated by an
 * operation name appearing in the lead's target when several transports of
 * the kind exist. Data-driven off `doc.operations` — no per-transport
 * special-casing.
 */
export const findConnectingDoc = ({ lead, node, edges }: Params) => {
	const target = collapseCasing(lead.target);

	if (!target) {
		return [];
	}

	const downstream = lead.direction === 'downstream';
	const hit = (id: string, doc: ConnectionDoc) => ({ edge: id, node: downstream ? doc.to : doc.from, anchor: downstream ? doc.toAnchor : doc.fromAnchor });
	const plain: ReturnType<typeof hit>[] = [];
	const transports: { hit: ReturnType<typeof hit>; opMatch: boolean }[] = [];

	for (const [id, doc] of edges) {
		const originMatches = downstream ? doc.from === node : doc.to === node;

		if (!originMatches || doc.type !== lead.kind) {
			continue;
		}

		if (doc.operations.length > 0) {
			// Multiplexed transport: the lead names an operation, the edge is the channel.
			transports.push({ hit: hit(id, doc), opMatch: doc.operations.some((op) => op.name !== '' && target.includes(collapseCasing(op.name))) });
			continue;
		}

		const label = id.split('--')[2] ?? '';
		const keys = [label, doc.fromAnchor?.pattern ?? '', doc.toAnchor?.pattern ?? ''].map(collapseCasing).filter(Boolean);

		if (keys.some((key) => key.includes(target) || target.includes(key))) {
			plain.push(hit(id, doc));
		}
	}

	// Among multiplexed transports, an operation-name match disambiguates; with
	// none, every transport of the kind is a candidate (one = unambiguous route,
	// several = ambiguity the caller reports as a gap).
	const opMatched = transports.filter((t) => t.opMatch);
	const transportResults = (opMatched.length > 0 ? opMatched : transports).map((t) => t.hit);

	return [...plain, ...transportResults];
};
