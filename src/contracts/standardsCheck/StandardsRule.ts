export const StandardsRule = {
	/** The same export name declared in more than one place. */
	NameDuplicate: 'name-duplicate',
	/** Export names identical after synonym-collapse and word-order normalization. */
	NameSynonym: 'name-synonym',
	/** Token-level copy-paste spans (jscpd). */
	Clone: 'clone',
	/** Function bodies identical after identifier/literal normalization. */
	AstDuplicate: 'ast-duplicate',
	/** A file over the standards' line cap. */
	SizeFile: 'size-file',
	/** A function, hook or component over its line cap. */
	SizeFunction: 'size-function',
	/** More than one export in a file, outside the closed exception list. */
	MultiExport: 'multi-export',
	/** A filename that does not match the export it holds. */
	FilenameMismatch: 'filename-mismatch',
	/** Sibling utils sharing a subject verb — a domain-folder graduation candidate. */
	DomainGraduation: 'domain-graduation',
	/** More files in one flat folder than the census cap allows. */
	FolderCensus: 'folder-census',
	/** An export nothing else references. */
	DeadExport: 'dead-export',
	/** An export only its own tests reference. */
	TestOnlyExport: 'test-only-export',
	/** An export reached only through a barrel, with no consuming module. */
	BarrelOnlyExport: 'barrel-only-export',
	/** A file deep-imported across a module boundary instead of through its barrel. */
	ModuleBoundary: 'module-boundary',
	/** Module-internal shared code (under a module's common/) leaking to an outside importer. */
	Placement: 'placement',
	/** A barrel re-exporting with `export *` instead of named re-exports. */
	BarrelStar: 'barrel-star',
	/** A barrel entry no file outside the module consumes. */
	BarrelDeadEntry: 'barrel-dead-entry',
	/** A module-scope mock variable Jest's hoisting cannot reach, because its name is not `mock`-prefixed. */
	TestMockPrefix: 'test-mock-prefix',
	/** A mock return value set in a lifecycle hook instead of the setup factory. */
	TestMockReturnInHook: 'test-mock-return-in-hook',
	/** A `jest.fn()` with no generic — the spy does not match the real signature. */
	TestMockUntyped: 'test-mock-untyped',
	/** A `jest.mock` factory wrapper that discards its arguments. */
	TestMockWrapperUntyped: 'test-mock-wrapper-untyped',
	/** A subject held in a `let` reassigned across hooks — mutable test state. */
	TestSharedLet: 'test-shared-let',
	/** An assertion in a lifecycle hook instead of the test body. */
	TestAssertInHook: 'test-assert-in-hook',
	/** A nested `describe` outside the `when …` / `for …` exception. */
	TestNestedDescribe: 'test-nested-describe',
	/** Manual mock cleanup in a hook, which the Jest config already does. */
	TestManualMockCleanup: 'test-manual-mock-cleanup',
	/** `toStrictEqual` with an asymmetric matcher — strict in name only. */
	TestStrictEqualMatcher: 'test-strict-equal-matcher',
	/** More than one setup factory call in one test. */
	TestMultipleSetups: 'test-multiple-setups',
	/** A setup factory grown past its parameter cap. */
	TestMegaFactory: 'test-mega-factory',
	/** A folder named for the role of the code it holds, outside its framework's carve-out. */
	PathBannedModuleName: 'path-banned-module-name',
	/** A file placed directly in `common/` instead of under one of its type folders. */
	PathCommonFlat: 'path-common-flat',
	/** A barrel under `common/`, which is definitionally boundary-less. */
	PathCommonBarrel: 'path-common-barrel',
	/** A unit test in a separate tests directory instead of beside its subject. */
	PathTestInTestsFolder: 'path-test-in-tests-folder',
	/** A co-located test whose first name segment names no source file in its folder. */
	PathTestNotColocated: 'path-test-not-colocated',
	/** Shared test fixtures or mocks living under `src/`, where they read as production source. */
	PathTestSupportInSrc: 'path-test-support-in-src',
	/** A test file whose subject its module's barrel does not export — a direct test is a promotion, so the subject belongs in the barrel. */
	PathTestUntestedSubjectNotPublic: 'path-test-untested-subject-not-public',
	/** A folder whose casing matches none of the doc's three resolutions. */
	PathFolderCasing: 'path-folder-casing',
	/** A graduated domain folder holding one file. */
	PathDomainFolderSingleFile: 'path-domain-folder-single-file',
} as const;

export type StandardsRule = (typeof StandardsRule)[keyof typeof StandardsRule];
