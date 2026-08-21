interface Params {
	/** A repo-relative path, always `/`-separated as every input the engine builds is. */
	path: string;
}

/** The last segment of a path — a file's name, or a folder's own name. */
export const getBaseName = ({ path }: Params): string => path.slice(path.lastIndexOf('/') + 1);
