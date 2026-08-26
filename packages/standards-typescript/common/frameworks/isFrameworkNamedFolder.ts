import { getBaseName } from '../paths/getBaseName.ts';
import type { FrameworkCarveOut } from '../types/FrameworkCarveOut.ts';
import { getSourceRoot } from './getSourceRoot.ts';

interface Params {
	/** A repo-relative folder path. */
	folder: string;
	/** The carve-out of the package that governs this folder. */
	carveOut: FrameworkCarveOut;
}

/**
 * Whether the framework mandates this folder's name, which is what exempts it
 * from the banned-module-name rule.
 *
 * It reads `exemptFolderNames`, which no framework in today's table fills: React
 * mandates no layout and NestJS wires by decorators rather than by folder, so
 * neither one's familiar vocabulary is a fact its documents state. The question
 * answers `no` everywhere until a real mandate appears, and it stays in the
 * vocabulary so the rule that would need it already asks — a framework that does
 * mandate a name is then one table entry away rather than a new exception layer.
 *
 * Matched inside the governing package's `src/` only, so a repo's fixture trees
 * and test helpers cannot pick up a mandate meant for source.
 */
export const isFrameworkNamedFolder = ({ folder, carveOut }: Params): boolean =>
	folder.startsWith(getSourceRoot({ carveOut })) && carveOut.exemptFolderNames.includes(getBaseName({ path: folder }));
