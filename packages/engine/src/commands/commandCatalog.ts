import { brainstormCatalogEntry } from '#src/commands/common/constants/brainstormCatalogEntry.ts';
import { doctorCatalogEntry } from '#src/commands/common/constants/doctorCatalogEntry.ts';
import { frictionCatalogEntry } from '#src/commands/common/constants/frictionCatalogEntry.ts';
import { implementCatalogEntry } from '#src/commands/common/constants/implementCatalogEntry.ts';
import { improveCatalogEntry } from '#src/commands/common/constants/improveCatalogEntry.ts';
import { planCatalogEntry } from '#src/commands/common/constants/planCatalogEntry.ts';
import { refactorCatalogEntry } from '#src/commands/common/constants/refactorCatalogEntry.ts';
import { resumeCatalogEntry } from '#src/commands/common/constants/resumeCatalogEntry.ts';
import { standardsCheckCatalogEntry } from '#src/commands/common/constants/standardsCheckCatalogEntry.ts';
import { standardsHealthCatalogEntry } from '#src/commands/common/constants/standardsHealthCatalogEntry.ts';
import { standardsValidateCatalogEntry } from '#src/commands/common/constants/standardsValidateCatalogEntry.ts';
import { statusCatalogEntry } from '#src/commands/common/constants/statusCatalogEntry.ts';
import { testCoverageToThresholdCatalogEntry } from '#src/commands/common/constants/testCoverageToThresholdCatalogEntry.ts';
import { voiceCatalogEntry } from '#src/commands/common/constants/voiceCatalogEntry.ts';
import type { CommandCatalogEntry } from '#src/contracts/index.ts';

/**
 * Every command lightsout offers, stated once.
 *
 * The CLI's usage text, the flag validator, the README infographics and the
 * web app's command pages all render from this array. A command that gains a
 * flag gains it here, and every reader of a flag learns about it in the same
 * commit.
 *
 * In group order — build, burn down, standards, housekeeping — which is the
 * order the commands page reads them in. The usage text's own line order is
 * `renderUsage`'s business, not this array's.
 *
 * `related` is filled by rule rather than by taste: every other member of an
 * entry's group, plus these explicit pairs — plan↔implement, implement↔resume,
 * refactor↔standards-check, test-coverage-to-threshold↔standards-check,
 * standards-validate↔standards-health, friction↔improve. Both halves of every
 * pair name each other, so the graph is symmetric by construction.
 *
 * Nothing in here imports a `.md` module, deliberately: step prose is a string
 * literal rather than a markdown import, which is what lets
 * scripts/buildWorkflowSpecs.mjs load this file under plain Node.
 */
export const commandCatalog: CommandCatalogEntry[] = [
	brainstormCatalogEntry,
	planCatalogEntry,
	implementCatalogEntry,
	resumeCatalogEntry,
	refactorCatalogEntry,
	testCoverageToThresholdCatalogEntry,
	standardsCheckCatalogEntry,
	standardsValidateCatalogEntry,
	standardsHealthCatalogEntry,
	statusCatalogEntry,
	doctorCatalogEntry,
	frictionCatalogEntry,
	improveCatalogEntry,
	voiceCatalogEntry,
];
