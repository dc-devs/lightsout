import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { GateHold } from '#src/contracts/index.ts';
import type { GateHolds } from '#src/gates/gateHolds/common/types/GateHolds.ts';
import { getGateHoldPaths } from '#src/gates/gateHolds/common/utils/getGateHoldPaths.ts';

interface Params {
	cwd: string;
}

/** One hold file, or undefined when it is missing, truncated or not a hold at all. */
const readOneHold = async ({ path }: { path: string }) => {
	const raw = await readFile(path, 'utf8').catch(() => undefined);

	if (raw === undefined) {
		return undefined;
	}

	try {
		return GateHold.parse(JSON.parse(raw));
	} catch {
		return undefined;
	}
};

/**
 * Every hold recorded in the shared folder, keyed by the lowercased reference
 * its file is named for.
 *
 * Mirrors `readRunLock` — read, zod-parse, and answer for the absent and the
 * corrupt case without throwing — with two deliberate differences. An absent
 * directory answers an empty map rather than undefined, so every caller has one
 * shape and none of them spells a "nothing here" case; and a file that will not
 * parse is skipped rather than failing the read, because one interrupted write
 * must not hide every other hold on the machine.
 */
export const readGateHolds = async ({ cwd }: Params): Promise<GateHolds> => {
	const { dir } = await getGateHoldPaths({ cwd });
	const names = await readdir(dir).catch((): string[] => []);
	const holds: GateHolds = {};

	for (const name of names.filter((entry) => entry.endsWith('.json'))) {
		const hold = await readOneHold({ path: join(dir, name) });

		if (hold !== undefined) {
			holds[name.slice(0, -'.json'.length).toLowerCase()] = hold;
		}
	}

	return holds;
};
