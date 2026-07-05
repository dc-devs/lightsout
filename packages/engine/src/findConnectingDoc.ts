import type { ConnectionDoc, DebugHopReport } from '@lightsout/contracts';

const normalized = (value: string) => value.toLowerCase().replace(/[^a-z0-9]/g, '');

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
 * `from-anchor`). Deterministic string match on kind + normalized target vs
 * the edge label / anchor patterns; zero matches is a GAP, multiple is
 * ambiguity — never a guess (prototype decision T7). Each hit resolves the
 * far node + the anchor to enter it (undefined when the doc lacks that side's
 * anchor — the caller records a gap, as with a repo node missing its anchor).
 */
export const findConnectingDoc = ({ lead, node, edges }: Params) => {
	const target = normalized(lead.target);

	if (!target) {
		return [];
	}

	const downstream = lead.direction === 'downstream';
	const results: { edge: string; node: string; anchor: ConnectionDoc['toAnchor'] }[] = [];

	for (const [id, doc] of edges) {
		const originMatches = downstream ? doc.from === node : doc.to === node;

		if (!originMatches || doc.type !== lead.kind) {
			continue;
		}

		const label = id.split('--')[2] ?? '';
		const keys = [label, doc.fromAnchor?.pattern ?? '', doc.toAnchor?.pattern ?? ''].map(normalized).filter(Boolean);

		if (keys.some((key) => key.includes(target) || target.includes(key))) {
			results.push({ edge: id, node: downstream ? doc.to : doc.from, anchor: downstream ? doc.toAnchor : doc.fromAnchor });
		}
	}

	return results;
};
