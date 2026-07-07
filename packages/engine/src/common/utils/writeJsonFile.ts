import { writeFile } from 'node:fs/promises';

interface Params {
	path: string;
	value: unknown;
}

/**
 * Write a value as tab-indented JSON with a trailing newline — the canonical
 * on-disk shape for every manifest, report, and trace the engine emits, so they
 * diff and format identically.
 */
export const writeJsonFile = async ({ path, value }: Params): Promise<void> => {
	await writeFile(path, `${JSON.stringify(value, undefined, '\t')}\n`, 'utf8');
};
