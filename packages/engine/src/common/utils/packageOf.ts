interface Params {
	/** Repo-relative file path. */
	file: string;
	/** Monorepo package parent dir (e.g. 'packages'). */
	packagesDir: string;
}

/** The package directory a file belongs to (`<packagesDir>/<name>/…` → `<name>`), or undefined for root-group files. */
export const packageOf = ({ file, packagesDir }: Params): string | undefined => {
	const prefix = `${packagesDir}/`;

	if (!file.startsWith(prefix)) {
		return undefined;
	}

	const rest = file.slice(prefix.length);
	const separator = rest.indexOf('/');

	return separator > 0 ? rest.slice(0, separator) : undefined;
};
