import { StandardsPassId } from '@/contracts';
import { checkAstFindings } from '@/standardsCheck/checkAstFindings';
import { checkBarrelHygiene } from '@/standardsCheck/checkBarrelHygiene';
import { checkClones } from '@/standardsCheck/checkClones';
import { checkDeadExports } from '@/standardsCheck/checkDeadExports';
import { checkFilenameDuplicates } from '@/standardsCheck/checkFilenameDuplicates';
import { checkModuleBoundaries } from '@/standardsCheck/checkModuleBoundaries';
import { checkPathsAndNames } from '@/standardsCheck/checkPathsAndNames';
import { checkPlacement } from '@/standardsCheck/checkPlacement';
import { checkStructure } from '@/standardsCheck/checkStructure';
import { checkTestShape } from '@/standardsCheck/checkTestShape';
import type { StandardsPass } from '@/standardsCheck/common/types/StandardsPass';

/**
 * The passes in tier order — the order `runStandardsCheck` walks them.
 *
 * An array rather than a keyed object because the order is part of the
 * contract: the paths-and-names pass first — it opens no source file at all —
 * then the cheap name-level work, then the compiler-gated work once TypeScript
 * has been resolved, and the test-shape pass last, since it reads a different
 * file list from every other and running it at the end keeps the progress
 * output reading as source work then test work.
 */
export const standardsPasses: Array<{ id: StandardsPassId; run: StandardsPass }> = [
	{ id: StandardsPassId.PathsAndNames, run: checkPathsAndNames },
	{ id: StandardsPassId.FilenameDuplicates, run: checkFilenameDuplicates },
	{ id: StandardsPassId.Clones, run: checkClones },
	{ id: StandardsPassId.AstFindings, run: checkAstFindings },
	{ id: StandardsPassId.ModuleBoundaries, run: checkModuleBoundaries },
	{ id: StandardsPassId.Placement, run: checkPlacement },
	{ id: StandardsPassId.BarrelHygiene, run: checkBarrelHygiene },
	{ id: StandardsPassId.Structure, run: checkStructure },
	{ id: StandardsPassId.DeadExports, run: checkDeadExports },
	{ id: StandardsPassId.TestShape, run: checkTestShape },
];
