import { readFile } from 'node:fs/promises';
import { messageOf } from '#src/common/utils/messageOf.ts';

interface Params {
	configPath: string;
}

/**
 * The file simply not being there, as opposed to unreadable — the one absence a
 * caller may treat as "no config".
 *
 * Structural rather than `instanceof Error`: jest hands test code a realm whose
 * `Error` is not the one `node:fs/promises` throws, so the instance check is
 * false for a real ENOENT and every missing config reads as unreadable.
 */
const isMissing = ({ error }: { error: unknown }) => typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT';

/**
 * The raw config text, or `undefined` when the repo has none.
 *
 * Read once here so `readConfig` and `readOptionalConfig` differ only in what
 * they do about absence — the two used to be one function whose callers made
 * that decision with a `.catch()`, which is how a broken config came to be
 * treated as a missing one.
 */
export const readConfigFile = async ({ configPath }: Params): Promise<string | undefined> => {
	try {
		return await readFile(configPath, 'utf8');
	} catch (error) {
		if (isMissing({ error })) {
			return undefined;
		}

		throw new Error(`lightsout.config.json at ${configPath} could not be read — ${messageOf({ error })}`);
	}
};
