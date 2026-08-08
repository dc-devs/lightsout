import type { StandardsFinding, StandardsRule } from '@/contracts';

interface Params {
	rule: StandardsRule;
	files: StandardsFinding['files'];
}

/**
 * A finding's identity: its rule plus the file paths it touches.
 *
 * Nothing else may enter the key. A key embedding a line number or a symbol
 * name gets a fresh identity whenever code above it moves, which breaks both
 * the debt ledger (accepted debt reappears) and the gate (a resolved finding
 * reads as unresolved, and an unresolved one as resolved).
 */
export const buildSiteKey = ({ rule, files }: Params): string =>
	`${rule}:${[...new Set(files.map((file) => file.path))].sort().join('|')}`;
