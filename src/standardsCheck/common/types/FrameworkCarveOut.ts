export interface FrameworkCarveOut {
	/** Folder names this package's framework mandates, exempt from the banned-name rule. */
	exemptFolderNames: string[];
	/** True when the framework mandates kebab-case folders throughout (NestJS). */
	kebabCase: boolean;
	/** Route directory names whose segments are URL-mapped and therefore kebab-case by mandate. */
	routerRoots: string[];
}
