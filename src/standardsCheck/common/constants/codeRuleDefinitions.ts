import { StandardsPassId, StandardsRule, StandardsSeverity } from '@/contracts';
import type { StandardsRuleDefinition } from '@/standardsCheck/common/types/StandardsRuleDefinition';

/**
 * The registry entries for every rule drawn from a `standards/code/…` document
 * — the shape of source code: its names, its files, its folders and its module
 * boundaries.
 *
 * Which half a rule belongs to is decided by the `doc` it names, never by the
 * pass that emits it, so placing a new entry stays a no-decision. The
 * counterpart is `testRuleDefinitions`; `standardsRuleRegistry` composes the
 * two and is where the compiler checks that every rule has an entry.
 */
export const codeRuleDefinitions = {
	[StandardsRule.NameDuplicate]: {
		doc: 'standards/code/architecture/architecture-decisions.md',
		summary: 'the same export name declared in more than one place',
		defaultSeverity: StandardsSeverity.Advisory,
		pass: StandardsPassId.FilenameDuplicates,
		needsTypescript: false,
	},
	[StandardsRule.NameSynonym]: {
		doc: 'standards/code/style-guide/conventions/naming.md',
		summary: 'export names differing only by synonym or word order',
		defaultSeverity: StandardsSeverity.Advisory,
		pass: StandardsPassId.FilenameDuplicates,
		needsTypescript: false,
	},
	[StandardsRule.Clone]: {
		doc: 'standards/code/architecture/architecture-decisions.md',
		summary: 'token-level copy-paste spans',
		defaultSeverity: StandardsSeverity.Advisory,
		pass: StandardsPassId.Clones,
		needsTypescript: false,
		defaultSettings: { minTokens: 50 },
	},
	[StandardsRule.AstDuplicate]: {
		doc: 'standards/code/architecture/architecture-decisions.md',
		summary: 'function bodies identical after identifier normalization',
		defaultSeverity: StandardsSeverity.Blocking,
		pass: StandardsPassId.AstFindings,
		needsTypescript: true,
		defaultSettings: { minBodyTokens: 40 },
	},
	[StandardsRule.SizeFile]: {
		doc: 'standards/code/style-guide/patterns/functions.md',
		summary: 'a file over the standards line cap',
		defaultSeverity: StandardsSeverity.Blocking,
		pass: StandardsPassId.AstFindings,
		needsTypescript: true,
		defaultSettings: { file: 250, tsxFile: 300 },
	},
	[StandardsRule.SizeFunction]: {
		doc: 'standards/code/style-guide/patterns/functions.md',
		summary: 'a function, hook or component over its line cap',
		defaultSeverity: StandardsSeverity.Advisory,
		pass: StandardsPassId.AstFindings,
		needsTypescript: true,
		defaultSettings: { function: 80, hook: 160, component: 200 },
	},
	[StandardsRule.MultiExport]: {
		doc: 'standards/code/style-guide/structure/one-export-per-file.md',
		summary: 'more than one export in a file, outside the closed exception list',
		defaultSeverity: StandardsSeverity.Blocking,
		pass: StandardsPassId.Structure,
		needsTypescript: false,
	},
	[StandardsRule.FilenameMismatch]: {
		doc: 'standards/code/style-guide/conventions/file-naming.md',
		summary: 'a filename that does not match the export it holds',
		defaultSeverity: StandardsSeverity.Advisory,
		pass: StandardsPassId.Structure,
		needsTypescript: false,
	},
	[StandardsRule.DomainGraduation]: {
		doc: 'standards/code/architecture/folder-structure.md',
		summary: 'sibling utils sharing a subject verb — a domain-folder candidate',
		defaultSeverity: StandardsSeverity.Advisory,
		pass: StandardsPassId.Structure,
		needsTypescript: false,
	},
	[StandardsRule.FolderCensus]: {
		doc: 'standards/code/architecture/folder-structure.md',
		summary: 'more files in one flat folder than the census cap allows',
		defaultSeverity: StandardsSeverity.Advisory,
		pass: StandardsPassId.Structure,
		needsTypescript: false,
		defaultSettings: { cap: 20 },
	},
	[StandardsRule.DeadExport]: {
		doc: 'standards/code/architecture/architecture-decisions.md',
		summary: 'an export nothing else references',
		defaultSeverity: StandardsSeverity.Advisory,
		pass: StandardsPassId.DeadExports,
		needsTypescript: false,
	},
	[StandardsRule.BarrelOnlyExport]: {
		doc: 'standards/code/style-guide/structure/module-api.md',
		summary: 'an export reached only through a barrel, with no consuming module',
		defaultSeverity: StandardsSeverity.Advisory,
		pass: StandardsPassId.DeadExports,
		needsTypescript: false,
	},
	[StandardsRule.ModuleBoundary]: {
		doc: 'standards/code/style-guide/structure/module-api.md',
		summary: 'a file deep-imported across a module boundary instead of through its barrel',
		defaultSeverity: StandardsSeverity.Blocking,
		pass: StandardsPassId.ModuleBoundaries,
		needsTypescript: true,
	},
	[StandardsRule.Placement]: {
		doc: 'standards/code/architecture/folder-structure.md',
		summary: "module-internal shared code leaking out of its module's common/",
		defaultSeverity: StandardsSeverity.Blocking,
		pass: StandardsPassId.Placement,
		needsTypescript: true,
	},
	[StandardsRule.BarrelStar]: {
		doc: 'standards/code/style-guide/structure/module-api.md',
		summary: 'a barrel re-exporting with `export *` instead of named re-exports',
		defaultSeverity: StandardsSeverity.Blocking,
		pass: StandardsPassId.BarrelHygiene,
		needsTypescript: false,
	},
	[StandardsRule.BarrelDeadEntry]: {
		doc: 'standards/code/style-guide/structure/module-api.md',
		summary: 'a barrel entry no file outside the module consumes',
		defaultSeverity: StandardsSeverity.Advisory,
		pass: StandardsPassId.BarrelHygiene,
		needsTypescript: false,
	},
	[StandardsRule.PathBannedModuleName]: {
		doc: 'standards/code/architecture/folder-structure.md',
		summary: 'a folder named for the role of the code it holds',
		defaultSeverity: StandardsSeverity.Blocking,
		pass: StandardsPassId.PathsAndNames,
		needsTypescript: false,
	},
	[StandardsRule.PathCommonFlat]: {
		doc: 'standards/code/architecture/folder-structure.md',
		summary: 'a file placed directly in `common/` instead of under a type folder',
		defaultSeverity: StandardsSeverity.Blocking,
		pass: StandardsPassId.PathsAndNames,
		needsTypescript: false,
	},
	[StandardsRule.PathCommonBarrel]: {
		doc: 'standards/code/style-guide/structure/module-api.md',
		summary: 'a barrel under `common/`, which is definitionally boundary-less',
		defaultSeverity: StandardsSeverity.Blocking,
		pass: StandardsPassId.PathsAndNames,
		needsTypescript: false,
	},
	[StandardsRule.PathFolderCasing]: {
		doc: 'standards/code/architecture/folder-structure.md',
		summary: "a folder whose casing matches none of the doc's three resolutions",
		defaultSeverity: StandardsSeverity.Advisory,
		pass: StandardsPassId.PathsAndNames,
		needsTypescript: false,
	},
	[StandardsRule.PathDomainFolderSingleFile]: {
		doc: 'standards/code/architecture/folder-structure.md',
		summary: 'a graduated domain folder holding one file',
		defaultSeverity: StandardsSeverity.Advisory,
		pass: StandardsPassId.PathsAndNames,
		needsTypescript: false,
	},
} satisfies Record<string, StandardsRuleDefinition>;
