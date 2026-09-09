import type { GateHold } from '#src/contracts/index.ts';

/**
 * Every hold the shared folder currently carries, keyed by lowercased ticket
 * reference — the document one drain reads once and threads to both refusal
 * sites.
 *
 * A plain type rather than a schema in `contracts/`, because nothing parses a
 * document of this shape: what is parsed is one `GateHold` per file, and this
 * map is assembled from them. The keys are lowercased because every other
 * identifier comparison in the queue is, and one site spelling it differently
 * would make a hold invisible to that site alone.
 */
export type GateHolds = Record<string, GateHold>;
