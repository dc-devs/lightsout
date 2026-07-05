import { createHash } from 'node:crypto';
import scanEdgesPrompt from '../prompts/scanEdges.md';

/**
 * Fingerprint of the scan-edges scanner — a hash of its prompt. Stamped onto
 * every inventory (`scannerVersion`) so build-map's freshness gate re-scans
 * when the SCANNER changes, not only when the scanned CODE changes: a prompt
 * change that alters the inventory format/content would otherwise leave
 * stale-format inventories silently reused past a SHA match. The prompt is
 * the fingerprint because adding an inventory field requires telling the
 * agent to emit it — a contract change without a prompt change produces no
 * new content, so reuse stays correct. (A rare format change that never
 * touches the prompt needs a manual nudge — edit the prompt.)
 */
export const scanEdgesVersion = createHash('sha256').update(scanEdgesPrompt).digest('hex').slice(0, 12);
