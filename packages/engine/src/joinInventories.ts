import type { ConnectionDoc, EdgeInventory, EdgeOperation, MapJoin } from '@lightsout/contracts';

/** Union both sides' operations by name (a multiplexed edge is sighted from BOTH the caller and the handler); a typed sighting wins over an untyped one. */
const mergeOperations = (a: EdgeOperation[], b: EdgeOperation[]): EdgeOperation[] => {
	const byName = new Map<string, EdgeOperation>();

	for (const op of [...a, ...b]) {
		const existing = byName.get(op.name);

		if (!existing || (existing.type === null && op.type !== null)) {
			byName.set(op.name, op);
		}
	}

	return [...byName.values()].sort((x, y) => x.name.localeCompare(y.name));
};

/** Exact-join normalization: case, trailing slash, `{id}`/`<id>` → `:id`. */
const normalizedKey = (key: string) =>
	key
		.trim()
		.toLowerCase()
		.replace(/\{([^}]+)\}/g, ':$1')
		.replace(/<([^>]+)>/g, ':$1')
		.replace(/\/+$/, '');

/** Tolerant second pass: also strip versioned prefixes (`/v2/event` ≈ `/event`) and collapse param names (`:id` ≈ `:param`). */
const fuzzyKey = (key: string) =>
	normalizedKey(key)
		.replace(/^\/v\d+(?=\/)/, '')
		.replace(/:[a-z0-9_]+/g, ':param');

type Sighting = { node: string; edge: EdgeInventory['edges'][number] };

interface Params {
	inventories: EdgeInventory[];
	/** The existing map, for confirmed/drifted classification. */
	edges: Map<string, ConnectionDoc>;
}

/**
 * The mechanical join (prototype decision T8): every real edge is sighted
 * twice — outbound in the sender, inbound in the receiver — so pairing
 * pooled inventories on (matchKey, kind) yields edges born with both
 * anchors code-verified. Exact normalization first; a tolerant pass catches
 * near-misses but marks them `fuzzy` so review sees them. Deterministic
 * string work throughout — no agent judgment.
 */
export const joinInventories = ({ inventories, edges }: Params): MapJoin => {
	const outs: Sighting[] = [];
	const ins: Sighting[] = [];
	const noise: MapJoin['noise'] = [];
	const gaps: MapJoin['gaps'] = [];

	for (const inventory of inventories) {
		for (const edge of inventory.edges) {
			if (edge.noise) {
				noise.push({ node: inventory.node, direction: edge.direction, kind: edge.kind, matchKey: edge.matchKey, at: edge.at });
				continue;
			}

			(edge.direction === 'out' ? outs : ins).push({ node: inventory.node, edge });
		}

		for (const gap of inventory.gaps) {
			gaps.push({ node: inventory.node, detail: gap });
		}
	}

	const matched: MapJoin['matched'] = [];
	const pairedIns = new Set<Sighting>();
	const pairedOuts = new Set<Sighting>();

	const pair = ({ keyOf, fuzzy }: { keyOf: (key: string) => string; fuzzy: boolean }) => {
		for (const out of outs) {
			if (pairedOuts.has(out)) {
				continue;
			}

			const candidates = ins.filter(
				(entry) =>
					!pairedIns.has(entry) &&
					entry.node !== out.node &&
					entry.edge.kind === out.edge.kind &&
					keyOf(entry.edge.matchKey) === keyOf(out.edge.matchKey),
			);
			const hit = candidates[0];

			if (!hit) {
				continue;
			}

			pairedOuts.add(out);
			pairedIns.add(hit);
			matched.push({
				from: out.node,
				to: hit.node,
				kind: out.edge.kind,
				matchKey: normalizedKey(out.edge.matchKey),
				fromSighting: { at: out.edge.at, pattern: out.edge.pattern, payload: out.edge.payload, schemaAt: out.edge.schemaAt },
				toSighting: { at: hit.edge.at, pattern: hit.edge.pattern, payload: hit.edge.payload, schemaAt: hit.edge.schemaAt },
				operations: mergeOperations(out.edge.operations, hit.edge.operations),
				fuzzy,
			});
		}
	};

	pair({ keyOf: normalizedKey, fuzzy: false });
	pair({ keyOf: fuzzyKey, fuzzy: true });

	// Intra-node self-loops: an unpaired out+in within ONE node sharing
	// kind+matchKey can never be a cross-node edge (pairing requires
	// entry.node !== out.node), so it's internal plumbing — a service's own
	// queue producer↔consumer. Route both sightings to noise instead of
	// double-listing them as orphan-out AND orphan-in.
	const internal = new Set<Sighting>();

	for (const out of outs) {
		if (pairedOuts.has(out) || internal.has(out)) {
			continue;
		}

		const selfHit = ins.find(
			(entry) =>
				!pairedIns.has(entry) &&
				!internal.has(entry) &&
				entry.node === out.node &&
				entry.edge.kind === out.edge.kind &&
				normalizedKey(entry.edge.matchKey) === normalizedKey(out.edge.matchKey),
		);

		if (!selfHit) {
			continue;
		}

		internal.add(out);
		internal.add(selfHit);

		for (const sighting of [out, selfHit]) {
			noise.push({
				node: sighting.node,
				direction: sighting.edge.direction,
				kind: sighting.edge.kind,
				matchKey: sighting.edge.matchKey,
				at: sighting.edge.at,
			});
		}
	}

	// Split matched pairs into new edges vs existing docs (confirmed/drifted).
	const confirmed: MapJoin['confirmed'] = [];
	const drifted: MapJoin['drifted'] = [];
	const newEdges: MapJoin['matched'] = [];

	for (const match of matched) {
		const existing = [...edges.entries()].find(([, doc]) => doc.from === match.from && doc.to === match.to && doc.type === match.kind);

		if (!existing) {
			newEdges.push(match);
			continue;
		}

		const [docId, doc] = existing;
		const fromAt = match.fromSighting.at.split(':')[0];
		const toAt = match.toSighting.at.split(':')[0];

		if (doc.fromAnchor && doc.fromAnchor.path !== fromAt) {
			drifted.push({ doc: docId, side: 'from', foundAt: match.fromSighting.at, pattern: match.fromSighting.pattern });
		} else if (doc.toAnchor && doc.toAnchor.path !== toAt) {
			drifted.push({ doc: docId, side: 'to', foundAt: match.toSighting.at, pattern: match.toSighting.pattern });
		} else {
			confirmed.push({ doc: docId });
		}
	}

	const orphan = (sighting: Sighting) => ({
		node: sighting.node,
		kind: sighting.edge.kind,
		matchKey: sighting.edge.matchKey,
		at: sighting.edge.at,
		payload: sighting.edge.payload,
	});

	return {
		matched: newEdges,
		confirmed,
		drifted,
		orphansOut: outs.filter((entry) => !pairedOuts.has(entry) && !internal.has(entry)).map(orphan),
		orphansIn: ins.filter((entry) => !pairedIns.has(entry) && !internal.has(entry)).map(orphan),
		noise,
		gaps,
	};
};
