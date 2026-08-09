interface Params {
	sourcePath: string;
	destPath: string;
	overwrite?: boolean;
}

// The same call, self-documenting at every site, and safe to grow.
export const copyFile = ({ sourcePath, destPath, overwrite = false }: Params): string =>
	`${sourcePath} -> ${destPath}${overwrite ? ' (overwrite)' : ''}`;
