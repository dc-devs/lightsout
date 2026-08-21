import type { RawStandardsFinding } from '@lightsout/standards-contracts';

interface Params {
	files: RawStandardsFinding['files'];
}

/**
 * The paths a finding names, deduped and sorted — the half of its site key that
 * says where.
 *
 * A rule reporting several sites per finding has to group them before it can
 * build one, and it has to group on exactly what the key is built from or two
 * groups would collide under a single identity. So the path half of the key is
 * written once here, and both the grouping and the key read it.
 */
export const getSiteGroupKey = ({ files }: Params): string => [...new Set(files.map((file) => file.path))].sort().join('|');
