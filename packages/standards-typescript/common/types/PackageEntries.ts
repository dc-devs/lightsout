/** Which folders are packages, and which files their manifests publish. */
export interface PackageEntries {
	/** Repo-relative package directories — `.` for a package at the repo root. */
	packageDirectories: Set<string>;
	/** Repo-relative files a manifest's `main`, `module`, `types` or `exports` names. */
	entryFiles: Set<string>;
}
