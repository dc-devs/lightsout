/** How one coverage scope's Jest loads a source file: the extensions it evaluates as native ES modules, where a module-scope `await` is a legal statement rather than a syntax error. */
export interface JestModuleMode {
	/** Extensions this scope's Jest evaluates as ES modules, each with its leading dot. `.js` and `.jsx` are absent because a `"type": "module"` manifest decides those per file rather than per scope, so `isEsmSourceFile` applies that rule instead. */
	esmExtensions: string[];
}
