import type { RawStandardsFinding, StandardsCheckModule, TypeCheckerInput } from '@lightsout/standards-contracts';
import { buildRawFinding } from '../../../../../common/findings/buildRawFinding.ts';
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
 */
const publishedNames = ({ links }: { links: ModuleLink[] }) =>
	links.filter((link) => link.reExport && !link.star).flatMap((link) => link.names.map((name) => ({ name: name.as, target: link.target })));

/**
 * Whether a barrel entry exists to satisfy the test standards rather than a
 * caller.
 *
 * `path-test-untested-subject-not-public` requires that a file with a dedicated
 * test be published by its module's barrel — a direct test is a promotion, not
 * an exception. Such an entry has a reader: the rule that demanded it. Reporting
 * it dead would set the two rules against each other and leave no edit that
 * satisfies both.
 *
 * The allowance is deliberately narrow. It applies only when this barrel
 * publishes the tested FILE, so a parent barrel passing a name through from a
 * child barrel gets nothing from it: the parent's line points at the child's
 * `index.ts`, which is not a tested subject, and a pass-through nobody imports
 * from the parent is exactly what this rule is for.
 */
const isTestedSubject = ({ target, tests }: { target?: string; tests: string[] }) => {
	if (target === undefined || isBarrelFile({ path: target })) {
		return false;
	}

	const stem = target.replace(/\.tsx?$/, '');

	return tests.some((test) => test.startsWith(`${stem}.`));
};

/**
 * The names something outside `folder` actually imports FROM this barrel.
 *
 * Two conservative allowances, both meaning "this run cannot say otherwise":
 * a link the compiler could not place might be pointing here, and a star import
 * takes the whole surface without naming any of it.
 */
const consumedNames = ({ barrelPath, folder, links }: { barrelPath: string; folder: string; links: Map<string, ModuleLink[]> }) => {
	const consumed = new Set<string>();
	let takesEverything = false;

	for (const [file, fileLinks] of links) {
		if (file.startsWith(`${folder}/`)) {
			continue;
		}

		for (const link of fileLinks.filter((entry) => entry.target === barrelPath || !entry.resolved)) {
			takesEverything = takesEverything || link.star;

			for (const name of link.names) {
				consumed.add(name.from);
			}
		}
	}

	return { consumed, takesEverything };
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

	return [...mapFolderModules({ files: input.files, getSurface, standardsPackages: input.standardsPackages })]
		.map(([folder, { barrelPath }]) => {
			const { consumed, takesEverything } = consumedNames({ barrelPath, folder, links });
			const orphans = takesEverything
				? []
				: publishedNames({ links: links.get(barrelPath) ?? [] })
						.filter((entry) => !consumed.has(entry.name) && !isTestedSubject({ target: entry.target, tests: input.tests }))
						.map((entry) => entry.name);

			return orphans.length === 0
				? undefined
				: buildRawFinding({
						rule: 'barrel-dead-entry',
						files: [{ path: barrelPath }],
						detail: `${orphans.map((name) => `'${name}'`).join(', ')} ${orphans.length > 1 ? 'are' : 'is'} exported from ${barrelPath} but nothing outside module '${folder}' imports ${orphans.length > 1 ? 'them' : 'it'} from there`,
						guidance: 'Deliberate public API, or dead? Only the author knows.',
					});
		})
		.filter((finding): finding is RawStandardsFinding => finding !== undefined);
};

export const check: StandardsCheckModule = {
	// Resolved imports, not name mentions. Counting mentions credited a comment,
	// a string, and an unrelated local of the same name as consumption, skipped
	// every name under four characters, and — the case that matters — could not
	// tell an import from a parent barrel from an import from the child it wraps.
	// A parent's pass-through entry that nothing imports FROM THE PARENT is dead
	// however busy the child is, and only a resolved specifier says which was
	// which.
	inputKind: 'type-checker',
	// Judged only for `module`-status folders: a barrel that hides nothing marks
	// no boundary, so nothing it lists is a public-surface claim to answer for.
	run: ({ input }): RawStandardsFinding[] => (input.kind === 'type-checker' ? buildFindings({ input }) : []),
};
