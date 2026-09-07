interface Params {
	/** The assertions to report, each as a repo-relative test file, a test name and a status (defaulting to passed). */
	tests: { file: string; name: string; status?: string }[];
}

/**
 * A gate command that leaves per-test evidence on disk, so a pipeline test can
 * exercise the evidence path without a real jest.
 *
 * It writes one results file into the directory the engine names in
 * `LIGHTSOUT_TEST_RESULTS_DIR`, and exits 0 doing nothing when that variable is
 * unset. The test file paths it writes are absolute, exactly as a runner reports
 * them, so the reader's re-relativising is exercised rather than bypassed.
 *
 * The repo root is read back out of that directory rather than from
 * `process.cwd()`: a temp dir sits under a symlink on macOS, and the working
 * directory a child reports is the resolved path, which no longer relativises
 * against the path the engine is holding. The results directory is the engine's
 * own spelling of that root plus a `.lightsout` segment.
 *
 * The payload rides as base64 because the command is a double-quoted shell
 * string and the JSON it carries is full of quotes.
 */
export const gateResultsCommand = ({ tests }: Params): string => {
	const payload = Buffer.from(JSON.stringify(tests)).toString('base64');

	const script = [
		"const fs=require('node:fs');",
		"const path=require('node:path');",
		'const dir=process.env.LIGHTSOUT_TEST_RESULTS_DIR;',
		'if(dir){',
		"const root=dir.split(path.sep+'.lightsout'+path.sep)[0];",
		`const tests=JSON.parse(Buffer.from('${payload}','base64').toString('utf8'));`,
		'const byFile=new Map();',
		'for(const entry of tests){',
		'const key=path.join(root,entry.file);',
		"byFile.set(key,[...(byFile.get(key)||[]),{title:entry.name,ancestorTitles:[],fullName:entry.name,status:entry.status||'passed',durationMs:1}]);",
		'}',
		'fs.mkdirSync(dir,{recursive:true});',
		"fs.writeFileSync(path.join(dir,process.pid+'-'+Date.now()+'.json'),JSON.stringify({testResults:[...byFile].map(([testFilePath,assertionResults])=>({testFilePath,assertionResults}))}));",
		'}',
	].join('');

	return `node -e "${script}"`;
};
