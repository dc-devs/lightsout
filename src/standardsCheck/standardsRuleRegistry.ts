import { StandardsPassId, StandardsRule, StandardsSeverity } from '@/contracts';
import type { StandardsRuleDefinition } from '@/standardsCheck/common/types/StandardsRuleDefinition';

/**
 * Every rule the standards check enforces, as data: the doc it comes from, its
 * default severity, the pass that produces it and that rule's own numeric
 * knobs. Imports no pass function, so `--list` and the config resolver can read
 * the whole ledger without loading the compiler-gated passes.
 *
 * Adding a rule is one entry here plus one line in the pass that emits it —
 * there is no second place a rule has to be registered.
 */
export const standardsRuleRegistry: Record<StandardsRule, StandardsRuleDefinition> = {
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
		defaultSeverity: StandardsSeverity.Finding,
		pass: StandardsPassId.AstFindings,
		needsTypescript: true,
		defaultSettings: { minBodyTokens: 40 },
	},
	[StandardsRule.SizeFile]: {
		doc: 'standards/code/style-guide/patterns/functions.md',
		summary: 'a file over the standards line cap',
		defaultSeverity: StandardsSeverity.Finding,
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
		defaultSeverity: StandardsSeverity.Finding,
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
	[StandardsRule.TestOnlyExport]: {
		doc: 'standards/tests/unit/jest/unit-testing.md',
		summary: 'an export only its own tests reference',
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
		defaultSeverity: StandardsSeverity.Finding,
		pass: StandardsPassId.ModuleBoundaries,
		needsTypescript: true,
	},
	[StandardsRule.Placement]: {
		doc: 'standards/code/architecture/folder-structure.md',
		summary: "module-internal shared code leaking out of its module's common/",
		defaultSeverity: StandardsSeverity.Finding,
		pass: StandardsPassId.Placement,
		needsTypescript: true,
	},
	[StandardsRule.BarrelStar]: {
		doc: 'standards/code/style-guide/structure/module-api.md',
		summary: 'a barrel re-exporting with `export *` instead of named re-exports',
		defaultSeverity: StandardsSeverity.Finding,
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
};
