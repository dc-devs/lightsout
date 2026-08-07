import { ScanDetector, ScanSeverity, type ScanFinding } from '@/contracts';
import { collapseCasing } from '@/common/naming/collapseCasing';
import { nameOf } from '@/common/naming/nameOf';

// The name position rejects `${` before capturing: a code GENERATOR emits its
// output as a template literal, so lines like `export const ${exportName}: …`
// sit inside a string yet still start at column 0, and a line-anchored regex
// reads them as declarations (live case: tools/generateStandardsBarrels.ts was
// reported as exporting `$`). `${` can never open a real identifier, so the
// guard costs no true positives. It fixes interpolated names only — a
// generator emitting a literal, fully-spelled export inside a template still
// reads as code, which needs a lexer this text-level pass deliberately avoids.
const exportPattern = /^export\s+(?:async\s+)?(const|class|function|interface|type|enum)\s+(?!\$\{)([A-Za-z0-9_$]+)/;

/** 'session-response.model' → ['session-response.model', 'session-response'] — framework dot-suffixes (.model/.dto/.entity/…) are convention, not a mismatch. */
const dotPrefixes = (name: string) => name.split('.').map((_, index, segments) => segments.slice(0, index + 1).join('.'));

interface Params {
	/** Repo-relative path, used for the finding's cluster and filename comparison. */
	file: string;
	/** The file's contents. */
	text: string;
}

/**
 * The per-file half of the structure lint: one-export-per-file outside the
 * closed exception list, and filename ↔ export-name match.
 *
 * Split out of `scanStructure` so that function is left sequencing its three
 * passes rather than carrying this logic inline. A module internal — covered
 * through `scanStructure`'s own tests, which is where its behaviour is pinned.
 */
export const scanFileExports = ({ file, text }: Params): ScanFinding[] => {
	const findings: ScanFinding[] = [];
	const exports: Array<{ keyword: string; name: string; line: string }> = [];

	for (const line of text.split('\n')) {
		const match = line.match(exportPattern);

		if (match?.[1] && match[2]) {
			exports.push({ keyword: match[1], name: match[2], line });
		}
	}

	if (exports.length === 0) {
		return findings;
	}

	// Closed exceptions to one-export-per-file:
	// - named constant: `const X` + `type X` sharing one name, plus any
	//   lookup-map consts typed `Record<X, …>` (exception 4)
	// - union family: interfaces + exactly one `type` alias (exception 3)
	const keywords = (keyword: string) => exports.filter((entry) => entry.keyword === keyword);
	const constTypeName = keywords('const').find(({ name }) => keywords('type').some((entry) => entry.name === name))?.name;
	const namedConstantFamily =
		constTypeName !== undefined &&
		exports.every(({ keyword, name, line }) => name === constTypeName || (keyword === 'const' && line.includes(`Record<${constTypeName}`)));
	const unionFamily = keywords('interface').length > 0 && keywords('type').length === 1 && keywords('interface').length + 1 === exports.length;

	if (exports.length > 1 && !namedConstantFamily && !unionFamily) {
		findings.push({
			detector: ScanDetector.Structure,
			severity: ScanSeverity.Finding,
			cluster: `multi-export:${file}`,
			files: [{ path: file }],
			detail: `${exports.length} exports (${exports.map(({ name }) => name).join(', ')})`,
			guidance: 'One export per file, outside the closed exception list.',
		});
	}

	const primary = exports[0];

	if (primary && exports.length === 1 && !dotPrefixes(nameOf(file)).some((candidate) => collapseCasing(candidate) === collapseCasing(primary.name))) {
		findings.push({
			detector: ScanDetector.Structure,
			severity: ScanSeverity.Advisory,
			cluster: `filename-mismatch:${file}`,
			files: [{ path: file }],
			detail: `file '${nameOf(file)}' exports '${primary.name}'`,
			guidance: 'The filename should match the export it holds.',
		});
	}

	return findings;
};
