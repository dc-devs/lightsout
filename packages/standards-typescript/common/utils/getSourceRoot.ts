import type { FrameworkCarveOut } from '../types/FrameworkCarveOut.ts';

interface Params {
	carveOut: FrameworkCarveOut;
}

/**
 * The `src/` prefix inside the package a carve-out came from.
 *
 * The banned-name and casing rules judge ONLY paths inside a package's source
 * tree — the repo root's or a workspace package's. Those rules govern the shape
 * of a package's SOURCE tree, while a check is handed every JS/TS file in the
 * repo; without this anchor a repo's own `tests/helpers/` and fixture trees
 * would report as violations of a rule that never applied to them.
 *
 * @param carveOut - the carve-out whose package supplies the anchor
 */
export const getSourceRoot = ({ carveOut }: Params): string => (carveOut.directory === '.' ? 'src/' : `${carveOut.directory}/src/`);
