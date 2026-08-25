import type { FrameworkCarveOut } from '../types/FrameworkCarveOut.ts';
import { isUnderRouterRoot } from './isUnderRouterRoot.ts';

interface Params {
	/** A repo-relative folder path. */
	folder: string;
	/** The carve-out of the package that governs this folder. */
	carveOut: FrameworkCarveOut;
}

/**
 * Whether the framework owns this folder's casing.
 *
 * Two facts, one question: NestJS mandates kebab-case throughout, and a router
 * root's segments become URL path segments and are therefore kebab-case by
 * mandate. Both are the casing rule's resolution step 2 — the package's
 * framework doc outranking the defaults — asked once rather than mixed by hand
 * at the one site that needed it.
 */
export const isFrameworkCasedFolder = ({ folder, carveOut }: Params): boolean => carveOut.kebabCase || isUnderRouterRoot({ path: folder, carveOut });
