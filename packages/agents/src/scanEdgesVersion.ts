/**
 * The scan-edges scanner's version — stamped onto every inventory
 * (`scannerVersion`) so build-map's freshness gate re-scans when the SCANNER
 * changes, not only when the scanned CODE changes (that axis is the git SHA).
 *
 * This is a DECLARED version, not an auto-hash, and deliberately so: the two
 * freshness axes are driven by different people. Repo freshness must be
 * automatic (the git SHA) because consumer developers change their code and
 * we can't predict it. The scanner is changed by US — so we declare its
 * version, like a migration number or a cache-key version.
 *
 * BUMP THIS whenever a change alters what an inventory CONTAINS — the
 * scanEdges prompt, buildScanEdgesInvocation, or the EdgeInventory contract.
 * (Not the join: it re-runs fresh from pooled inventories every build-map, so
 * join changes take effect without a re-scan.) Older-versioned and legacy
 * (null) inventories re-scan on the next build-map.
 *
 * History:
 *   1 — original edge scanner.
 *   2 — multiplexed edges (GraphQL/tRPC/… as one transport edge carrying
 *       operations); EdgeInventory gained `operations` + the `graphql` kind.
 */
export const scanEdgesVersion = '2';
