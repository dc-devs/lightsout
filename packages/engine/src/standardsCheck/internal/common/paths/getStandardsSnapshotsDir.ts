import { join } from 'node:path';

interface Params {
	cwd: string;
}

/**
 * Dated snapshots gather in one place: `<repo>/.lightsout/standards-check`.
 *
 * The directory and the latest-snapshot file differ only by extension, which is
 * legal on every filesystem — and is the point: the dated copies sit under a
 * name that says what they are, rather than a second name nobody would guess.
 */
export const getStandardsSnapshotsDir = ({ cwd }: Params): string => {
	return join(cwd, '.lightsout', 'standards-check');
};
