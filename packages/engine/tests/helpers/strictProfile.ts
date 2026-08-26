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
	'banned-folder-name': 'blocking',
	'bare-string-union': 'blocking',
	'barrel-is-only-consumer': 'blocking',
	'barrel-star': 'blocking',
	'barrel-under-common': 'blocking',
	casing: 'blocking',
	'class-inheritance': 'blocking',
	'code-in-index-file': 'blocking',
	'file-directly-in-common': 'blocking',
	'folder-casing': 'blocking',
	'import-path-alias': 'blocking',
	'module-boundary': 'blocking',
	'multi-export': 'blocking',
	'oversized-setup-factory': 'blocking',
	placement: 'blocking',
	'single-file-domain-folder': 'blocking',
	'single-use-scalar': 'blocking',
	'size-file': 'blocking',
	'test-in-tests-folder': 'blocking',
	'test-manual-mock-cleanup': 'blocking',
	'test-mock-return-in-hook': 'blocking',
	'test-nested-describe': 'blocking',
	'test-not-beside-subject': 'blocking',
	'test-size-file': 'blocking',
	'test-support-in-src': 'blocking',
};
