import { autoPlanCatalogEntry } from '#src/commands/common/constants/build/autoPlanCatalogEntry.ts';
import { brainstormCatalogEntry } from '#src/commands/common/constants/build/brainstormCatalogEntry.ts';
import { implementCatalogEntry } from '#src/commands/common/constants/build/implementCatalogEntry.ts';
import { implementDirectCatalogEntry } from '#src/commands/common/constants/build/implementDirectCatalogEntry.ts';
import { planCatalogEntry } from '#src/commands/common/constants/build/planCatalogEntry.ts';
import { queueCatalogEntry } from '#src/commands/common/constants/build/queueCatalogEntry.ts';
import { resumeCatalogEntry } from '#src/commands/common/constants/build/resumeCatalogEntry.ts';
import { shipCatalogEntry } from '#src/commands/common/constants/build/shipCatalogEntry.ts';
import { refactorCatalogEntry } from '#src/commands/common/constants/burnDown/refactorCatalogEntry.ts';
import { testCoverageToThresholdCatalogEntry } from '#src/commands/common/constants/burnDown/testCoverageToThresholdCatalogEntry.ts';
import { doctorCatalogEntry } from '#src/commands/common/constants/housekeeping/doctorCatalogEntry.ts';
import { frictionCatalogEntry } from '#src/commands/common/constants/housekeeping/frictionCatalogEntry.ts';
import { improveCatalogEntry } from '#src/commands/common/constants/housekeeping/improveCatalogEntry.ts';
import { statusCatalogEntry } from '#src/commands/common/constants/housekeeping/statusCatalogEntry.ts';
import { voiceCatalogEntry } from '#src/commands/common/constants/housekeeping/voiceCatalogEntry.ts';
import { standardsCheckCatalogEntry } from '#src/commands/common/constants/standards/standardsCheckCatalogEntry.ts';
import { standardsHealthCatalogEntry } from '#src/commands/common/constants/standards/standardsHealthCatalogEntry.ts';
import { standardsValidateCatalogEntry } from '#src/commands/common/constants/standards/standardsValidateCatalogEntry.ts';
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
	autoPlanCatalogEntry,
	implementCatalogEntry,
	implementDirectCatalogEntry,
	resumeCatalogEntry,
	shipCatalogEntry,
	queueCatalogEntry,
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
