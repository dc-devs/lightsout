/**
 * The layout and structure rules the default pack ships `advisory`, promoted
 * to `blocking` — the strict profile lightsout's own repository runs.
 *
 * The consumer repos these helpers build plant layout defects (a second export
 * in a file, a file over its cap) as work the pipeline must do, not advice it
 * may decline. The pack stopped blocking on those by default so a repository
 * adopting lightsout is not stopped on day one by a layout it has not agreed
 * to; a fixture that wants them blocking says so, the way a strict repo does.
 */
export const strictProfile: Record<string, 'blocking'> = {
	'banned-class-shapes': 'blocking',
	'bare-string-union': 'blocking',
	'barrel-only-export': 'blocking',
	'barrel-star': 'blocking',
	casing: 'blocking',
	'class-inheritance': 'blocking',
	'import-path-alias': 'blocking',
	'index-not-barrel': 'blocking',
	'module-boundary': 'blocking',
	'multi-export': 'blocking',
	'path-banned-module-name': 'blocking',
	'path-common-barrel': 'blocking',
	'path-common-flat': 'blocking',
	'path-domain-folder-single-file': 'blocking',
	'path-folder-casing': 'blocking',
	'path-test-in-tests-folder': 'blocking',
	'path-test-not-colocated': 'blocking',
	'path-test-support-in-src': 'blocking',
	placement: 'blocking',
	'single-use-scalar': 'blocking',
	'size-file': 'blocking',
	'test-manual-mock-cleanup': 'blocking',
	'test-mega-factory': 'blocking',
	'test-mock-return-in-hook': 'blocking',
	'test-nested-describe': 'blocking',
	'test-size-file': 'blocking',
};
