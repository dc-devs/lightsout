import type { StandardsCheckModule } from '@lightsout/standards-contracts';
import { readManifestDependencies } from '../../../../../common/checkInput/readManifestDependencies.ts';
import { buildFileExportCheck } from '../../../../../common/checks/buildFileExportCheck.ts';
import { getFrameworkCarveOuts } from '../../../../../common/frameworks/getFrameworkCarveOuts.ts';
import { getPathCarveOut } from '../../../../../common/frameworks/getPathCarveOut.ts';
import { isEntryFile } from '../../../../../common/frameworks/isEntryFile.ts';
import { isUnderRouterRoot } from '../../../../../common/frameworks/isUnderRouterRoot.ts';
import { collapseCasing } from '../../../../../common/naming/collapseCasing.ts';
import { getExportName } from '../../../../../common/naming/getExportName.ts';

/**
 * `events.service` → `['events', 'events.service']`. A framework dot-suffix
 * (`.service`, `.model`, `.dto`, `.entity`) is the framework naming the file,
 * which this document says overrides casing entirely — so a name matching
 * either the whole thing or the part before the suffix is a match.
 */
const getDotPrefixes = ({ name }: { name: string }) => name.split('.').map((_, index, segments) => segments.slice(0, index + 1).join('.'));

/** Whether the file's name matches the export it holds, at any of its dot prefixes and in either casing convention. */
const isNameMatch = ({ fileName, exportName }: { fileName: string; exportName: string }) =>
	getDotPrefixes({ name: fileName }).some((candidate) => collapseCasing({ name: candidate }) === collapseCasing({ name: exportName }));

/**
 * Silent on a file holding two or more exports: there is no single export for
 * a name to match, and the one-export-per-file rule already owns that file.
 *
 * The comparison ignores casing — which convention a directory follows is the
 * document's own ordered question, and answering it would need the directory's
 * history rather than the file in hand. What is left is mechanical: the file
 * and its export are either the same word or they are not.
 *
 * Silent too on the files inside a package's router directory. This document's
 * step 2 says a framework mandate overrides the naming entirely, and a file
 * router mandates every name in there — `__root.tsx`, `runs.$runId.tsx` — while
 * each such file exports one `Route` const. Judged, every route file in a
 * TanStack, Next, Remix or Expo package would be a finding no author is allowed
 * to fix.
 *
 * Silent too on the files a framework resolves by convention. `src/router.tsx`
 * exports `getRouter`, `src/server.ts` a default from `createServerEntry`,
 * `src/main.ts` NestJS's bootstrap — each is a name the framework chose and
 * reaches for itself, so the export inside was never what named the file.
 */
export const check: StandardsCheckModule = buildFileExportCheck({
	rule: 'filename-mismatch',
	getExempt: ({ files, contents }) => {
		const carveOuts = getFrameworkCarveOuts({ dependencies: readManifestDependencies({ contents }) });

		return new Set(
			files.filter((file) => {
				const carveOut = getPathCarveOut({ carveOuts, path: file });

				return isUnderRouterRoot({ path: file, carveOut }) || isEntryFile({ path: file, carveOut });
			}),
		);
	},
	detail: ({ file, exports }) => {
		const [primary] = exports;
		const fileName = getExportName({ path: file });

		return primary === undefined || exports.length > 1 || isNameMatch({ fileName, exportName: primary.name })
			? undefined
			: `file '${fileName}' exports '${primary.name}'`;
	},
	guidance: 'The filename should match the export it holds.',
});
