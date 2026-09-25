import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

interface HoldsFolderParams {
	/** Hold files to plant before the act, by file name, written as raw bytes so a corrupt one can be arranged. */
	planted?: Record<string, string>;
	/** Folders to plant in the holds directory, which a read of one cannot answer bytes for. */
	plantedFolders?: string[];
}

/**
 * A directory with no repository above it, so git answers nothing and the run's
 * own `.lightsout` is the shared one — which is where these cases read and
 * write, without a checkout to stand up for each of them.
 */
export const setupGateHoldsFolder = ({ planted, plantedFolders = [] }: HoldsFolderParams = {}) => {
	const cwd = mkdtempSync(join(tmpdir(), 'lightsout-gate-holds-'));
	const holdsDir = join(cwd, '.lightsout', 'gate-holds');

	if (planted !== undefined || plantedFolders.length > 0) {
		mkdirSync(holdsDir, { recursive: true });

		for (const [name, content] of Object.entries(planted ?? {})) {
			writeFileSync(join(holdsDir, name), content, 'utf8');
		}

		for (const name of plantedFolders) {
			mkdirSync(join(holdsDir, name), { recursive: true });
		}
	}

	return { cwd, holdsDir };
};
