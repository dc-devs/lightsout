import { extname } from 'node:path';
import type { JestModuleMode } from '#src/coverage/selectUnloadableFiles/common/types/JestModuleMode.ts';

/** `.js`/`.jsx` are the only extensions whose module system a `"type": "module"` manifest decides; everything else is settled by the configuration alone. */
const manifestDecidedExtensions = ['.js', '.jsx'];

interface Params {
	/** Repo-relative path — only its extension is read. */
	path: string;
	/** The scope's resolved module mode, or undefined when its configuration could not be found or evaluated — which answers `false`, exactly today's behaviour. */
	moduleMode: JestModuleMode | undefined;
	/** The `"type"` of the nearest package.json governing this file, or undefined when none declares one. */
	packageType: string | undefined;
}

/**
 * Whether the scope's Jest loads this file as a native ES module, where a
 * module-scope `await` is legal and the file is coverable.
 *
 * Every uncertain answer is `false`. An unread configuration, an extension
 * nothing marks as ESM, and a manifest that declares no `type` all report
 * CommonJS, so this check can only ever add files to the executed bar on
 * positive evidence, never remove an exemption a repo is relying on.
 */
export const isEsmSourceFile = ({ path, moduleMode, packageType }: Params): boolean => {
	if (moduleMode === undefined) {
		return false;
	}

	const extension = extname(path);

	return moduleMode.esmExtensions.includes(extension) || (packageType === 'module' && manifestDecidedExtensions.includes(extension));
};
