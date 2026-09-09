import type { RawStandardsFinding } from '@lightsout/standards-contracts';
import { getSiteGroupKey } from './getSiteGroupKey.ts';

interface Params {
	/** The rule id, exactly as its folder names it — the first half of the site key. */
	rule: string;
	files: RawStandardsFinding['files'];
	detail: string;
	guidance: string;
	/** The number this rule compared against its cap, when it has one. */
	measure?: number;
}

/**
 * One finding, with its identity derived from the very files it reports.
 *
 * A check states neither its rule nor its severity — the engine stamps both
 * from the folder the check was loaded from. What is left for a check to get
 * wrong is the site key, so it is built here from the rule id and the reported
 * paths alone: a key holding a line number or a symbol name would take a fresh
 * identity whenever code above it moved, which breaks the debt ledger (accepted
 * debt reappears) and the gate (a resolved finding reads as unresolved).
 */
export const buildRawFinding = ({ rule, files, detail, guidance, measure }: Params): RawStandardsFinding => ({
	siteKey: `${rule}:${getSiteGroupKey({ files })}`,
	files,
	detail,
	guidance,
	// Spread rather than assigned, so an unmeasured rule's finding carries no
	// `measure` key at all — a key holding undefined would change the shape every
	// unmeasured rule asserts on.
	...(measure === undefined ? {} : { measure }),
});
