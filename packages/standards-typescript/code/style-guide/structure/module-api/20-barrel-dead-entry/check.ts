import type { RawStandardsFinding, StandardsCheckModule, TypeCheckerInput } from '@lightsout/standards-contracts';
import { buildRawFinding } from '../../../../../common/findings/buildRawFinding.ts';
import { getFrameworkCarveOuts } from '../../../../../common/frameworks/getFrameworkCarveOuts.ts';
import { getPathCarveOut } from '../../../../../common/frameworks/getPathCarveOut.ts';
import { isFrameworkLoadedFile } from '../../../../../common/frameworks/isFrameworkLoadedFile.ts';
import { isMandatedModuleFolder } from '../../../../../common/frameworks/isMandatedModuleFolder.ts';
import { mapFolderModules } from '../../../../../common/modules/mapFolderModules.ts';
import { readModuleLinks } from '../../../../../common/modules/readModuleLinks.ts';
import { isBarrelFile } from '../../../../../common/paths/isBarrelFile.ts';
import type { ModuleLink } from '../../../../../common/types/ModuleLink.ts';

/** Every module link the run could read, keyed by the file that wrote it. */
const readLinks = ({ input }: { input: TypeCheckerInput }) => {
	const byFile = new Map<string, ModuleLink[]>();

	for (const [path, { sourceFile, checker }] of input.typedFiles) {
		byFile.set(path, readModuleLinks({ sourceFile, checker, compiler: input.compiler, cwd: input.cwd }));
	}

	return byFile;
};

/**
 * The names a barrel publishes, each with the file it publishes.
 *
 * An `export *` line publishes names it does not write down, so it contributes
 * none here — `barrel-star` is the rule that objects to that.
 *
 * An `export type { … }` line contributes none either. A type published beside
 * the function whose signature names it is part of that function's contract,
 * and nobody having written `const x: T = f()` yet is not evidence the type is
 * dead. All three type entries this rule reported on a real repo were exactly
 * that: the return element of a published function, a field of a published
 * result, the return type of a published factory.
 */
const getPublishedNames = ({ links }: { links: ModuleLink[] }) =>
	links
		.filter((link) => link.reExport && !link.star && !link.typeOnly)
		.flatMap((link) => link.names.map((name) => ({ name: name.as, from: name.from, target: link.target })));

/**
 * The file that actually declares a published name, and the name that file
 * exports it under.
 *
 * A name is often published through a chain — `runState/index.ts` publishes
 * `acquireRunLock` from `runState/lock/index.ts`, which publishes it from
 * `runState/lock/acquireRunLock.ts` — so the file behind an entry is found by
 * following the name, hop by hop, until the target stops being a barrel. The
 * name can be renamed on the way (`export { a as b }`), which is why each hop
 * looks the next one up by the name the barrel published it AS and carries on
 * with the name the target knows it by.
 */
const getDeclaration = ({
	name,
	target,
	links,
	seen,
}: {
	name: string;
	target?: string;
	links: Map<string, ModuleLink[]>;
	seen: Set<string>;
}): { file: string; name: string } | undefined => {
	if (target === undefined || !isBarrelFile({ path: target }) || seen.has(target)) {
		return target === undefined ? undefined : { file: target, name };
	}

	seen.add(target);

	const next = (links.get(target) ?? []).filter((link) => link.reExport).find((link) => link.names.some((entry) => entry.as === name));

	return next === undefined
		? { file: target, name }
		: getDeclaration({ name: next.names.find((entry) => entry.as === name)?.from ?? name, target: next.target, links, seen });
};

/**
 * Whether a barrel entry exists to satisfy the test standards rather than a
 * caller.
 *
 * The unit-testing standards treat a tested barrel entry as consumed: a file with a dedicated
 * test be published by its module's barrel — a direct test is a promotion, not
 * an exception. Such an entry has a reader: the rule that demanded it. Reporting
 * it dead would set the two rules against each other and leave no edit that
 * satisfies both.
 *
 * The allowance follows the name to the file it actually comes from, however
 * many barrels it travelled, and then applies only if that file belongs to THIS
 * module. A barrel further up passing the same name through earns nothing: the
 * test standards asked the file's own module to publish it, and sparing the
 * ancestor would hide exactly the unused pass-through this rule exists to find.
 */
const isTestedSubject = ({
	name,
	target,
	folder,
	links,
	moduleFolders,
	tests,
}: {
	name: string;
	target?: string;
	folder: string;
	links: Map<string, ModuleLink[]>;
	moduleFolders: string[];
	tests: string[];
}) => {
	const file = getDeclaration({ name, target, links, seen: new Set() })?.file;

	if (file === undefined || isBarrelFile({ path: file })) {
		return false;
	}

	// `moduleFolders` is sorted longest-first, so the first match is the module
	// the file belongs to rather than any ancestor holding it.
	if (moduleFolders.find((candidate) => file.startsWith(`${candidate}/`)) !== folder) {
		return false;
	}

	const stem = file.replace(/\.tsx?$/, '');

	return tests.some((test) => test.startsWith(`${stem}.`));
};

/** One name a barrel publishes, with the file and name that declare it. */
interface PublishedEntry {
	/** The name the barrel publishes. */
	name: string;
	/** The name its target knows it by — they differ on a renamed entry. */
	from: string;
	target?: string;
	declaration?: { file: string; name: string };
}

/**
 * The entries of this barrel something outside `folder` actually imports —
 * from the file that declares the name, or from the barrel itself.
 *
 * Importing the declaring file is what an entry exists to allow: code outside
 * a module may import only the files its barrel exports, so an entry is in use
 * exactly when something outside the module imports the name it publishes.
 * An outer barrel passing a name through answers for importers outside ITS
 * folder, so a name only its own nested modules use is still dead there.
 *
 * Two conservative allowances, both meaning "this run cannot say otherwise":
 * a link the compiler could not place might be pointing here, and a star import
 * takes the whole surface without naming any of it.
 */
const getConsumedEntries = ({
	barrelPath,
	folder,
	entries,
	links,
}: {
	barrelPath: string;
	folder: string;
	entries: PublishedEntry[];
	links: Map<string, ModuleLink[]>;
}) => {
	const consumed = new Set<string>();

	for (const [file, fileLinks] of links) {
		if (file.startsWith(`${folder}/`)) {
			continue;
		}

		for (const link of fileLinks) {
			for (const entry of entries) {
				const takesName = (name: string) => link.star || link.names.some((imported) => imported.from === name);
				const fromBarrel = link.target === barrelPath && takesName(entry.name);
				const fromDeclaringFile = entry.declaration !== undefined && link.target === entry.declaration.file && takesName(entry.declaration.name);
				const unplaced =
					!link.resolved && (link.star || link.names.some((imported) => imported.from === entry.name || imported.from === entry.declaration?.name));

				if (fromBarrel || fromDeclaringFile || unplaced) {
					consumed.add(entry.name);
				}
			}
		}
	}

	return consumed;
};

const buildFindings = ({ input }: { input: TypeCheckerInput }) => {
	const links = readLinks({ input });
	const getSurface = ({ barrelPath }: { barrelPath: string }) => {
		const barrelLinks = (links.get(barrelPath) ?? []).filter((link) => link.reExport);

		return {
			targets: new Set(barrelLinks.flatMap((link) => (link.target === undefined ? [] : [link.target]))),
			complete: links.has(barrelPath) && barrelLinks.every((link) => link.resolved),
		};
	};

	const carveOuts = getFrameworkCarveOuts({ dependencies: input.dependencies });
	const modules = [
		...mapFolderModules({
			files: input.files,
			getSurface,
			standardsPacks: input.standardsPacks,
			// A mandated module has a public API the same way a graduated one does,
			// so its barrel answers for dead entries like any other module's.
			isMandatedModule: ({ folder }) => isMandatedModuleFolder({ folder, carveOut: getPathCarveOut({ carveOuts, path: folder }) }),
			// A router root's `index.tsx` is a route, so it marks no boundary and its
			// siblings are not somebody's unexported internals.
			isFrameworkLoaded: ({ path }) => isFrameworkLoadedFile({ path, carveOut: getPathCarveOut({ carveOuts, path }) }),
		}),
	];
	// Longest first, so the first match for a file is the module it belongs to
	// rather than one of its ancestors.
	const moduleFolders = modules.map(([folder]) => folder).sort((left, right) => right.length - left.length);

	return modules
		.map(([folder, { barrelPath }]) => {
			const entries = getPublishedNames({ links: links.get(barrelPath) ?? [] }).map((entry) => ({
				...entry,
				declaration: getDeclaration({ name: entry.from, target: entry.target, links, seen: new Set() }),
			}));
			const consumed = getConsumedEntries({ barrelPath, folder, entries, links });
			const orphans = entries
				.filter(
					(entry) =>
						!consumed.has(entry.name) && !isTestedSubject({ name: entry.from, target: entry.target, folder, links, moduleFolders, tests: input.tests }),
				)
				.map((entry) => entry.name);

			return orphans.length === 0
				? undefined
				: buildRawFinding({
						rule: 'barrel-dead-entry',
						files: [{ path: barrelPath }],
						detail: `${orphans.map((name) => `'${name}'`).join(', ')} ${orphans.length > 1 ? 'are' : 'is'} exported from ${barrelPath} but nothing outside module '${folder}' imports ${orphans.length > 1 ? 'them' : 'it'}`,
						guidance: 'Deliberate public API, or dead? Only the author knows.',
					});
		})
		.filter((finding): finding is RawStandardsFinding => finding !== undefined);
};

export const check: StandardsCheckModule = {
	// Resolved imports, not name mentions. Counting mentions credited a comment,
	// a string, and an unrelated local of the same name as consumption, skipped
	// every name under four characters, and — the case that matters — could not
	// follow a published name to the file that declares it. Code imports a name
	// from its declaring file, so only a resolved specifier and the barrel chain
	// behind each entry say which entry an import uses.
	inputKind: 'type-checker',
	// Judged only for `module`-status folders: a barrel that hides nothing marks
	// no boundary, so nothing it lists is a public-surface claim to answer for.
	run: ({ input }): RawStandardsFinding[] => (input.kind === 'type-checker' ? buildFindings({ input }) : []),
};
