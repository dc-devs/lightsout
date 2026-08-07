import { stat } from 'node:fs/promises';

interface Params {
	path: string;
}

/**
 * True when a path exists on disk. A `stat` that resolves means it exists; any
 * rejection (missing, permission) means it does not. Never throws.
 */
export const pathExists = ({ path }: Params): Promise<boolean> =>
	stat(path).then(
		() => true,
		() => false,
	);
