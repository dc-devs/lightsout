/**
 * @jest-environment node
 */
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, test } from '@jest/globals';

// The frame the README GIF is built from, checked as text.
//
// `scripts/renderSprawlSvg.mjs` and the `SprawlChart` component call one
// geometry — `buildSprawlLayout`, in this package — so what the image draws is
// a contract this package owns, even though the renderer sits at the repo root.
// It lives in tests/ rather than beside a source file because the subject is
// outside src/ and names nothing next to it.
//
// The renderer is an ES module, and this package's Jest runs CommonJS, so it is
// called in a child Node process and its SVG comes back on stdout — the same
// way every other root script in this repo is exercised.

const repoRoot = join(__dirname, '..', '..', '..', '..');
const rendererUrl = pathToFileURL(join(repoRoot, 'scripts', 'renderSprawlSvg.mjs')).href;

/**
 * The child program. It rebuilds the two lane states as `Map`s — the shape
 * `buildSprawlLaneStates` hands the renderer, and the one thing JSON cannot
 * carry across the process boundary.
 */
const child = `
import { renderSprawlSvg } from ${JSON.stringify(rendererUrl)};

const input = JSON.parse(process.env.SPRAWL_INPUT);
const toState = ({ files, folders }) => ({ files: new Map(Object.entries(files)), folders: new Map(Object.entries(folders)), overCap: 0 });

process.stdout.write(renderSprawlSvg({ ...input, withState: toState(input.withLane), withoutState: toState(input.withoutLane) }));
`;

/**
 * Deliberately not the shipped palette. Black to white makes the gradient
 * arithmetic readable in an assertion, and each remaining surface gets a colour
 * nothing else uses so a rectangle can be told apart by what it is painted in.
 */
const theme = { ground: '#101010', barFrom: '#000000', barTo: '#ffffff', muted: '#446688', mutedOpacity: 0.4, overCap: '#ee0000', text: '#dddddd' };

const fillOf = ({ tag }: { tag: string }) => /fill="([^"]+)"/.exec(tag)?.[1];

/**
 * One rendered frame, with the rectangles split by the width only that kind of
 * rectangle has: a bar is a fortieth of the 1200-px lane, a folder square is
 * the edge `buildSprawlLayout` sizes it to, and the ground is the whole frame.
 *
 * The two lanes differ on purpose. The counterfactual on top holds one
 * 280-line `.tsx` and an under-cap folder; the real lane below holds three
 * files, the largest of them past the plain file cap, and a folder past the
 * census cap. Between them every branch the renderer takes is drawn once.
 */
const setupSvg = ({ width = 1200, subject = 'add the sprawl chart' }: { width?: number; subject?: string } = {}) => {
	const input = {
		withLane: { files: { 'a/big.ts': 400, 'a/mid.ts': 200, 'a/small.ts': 100 }, folders: { a: 3 } },
		withoutLane: { files: { 'a/big.tsx': 280 }, folders: { b: 1 } },
		maxLines: 400,
		caps: { file: 250, tsxFile: 300, function: 80, testFile: 400, folderCensus: 2 },
		frame: { sha: 'abc1234', at: '2026-01-01T00:00:00Z', subject, isRefactorMarker: false },
		counter: { without: 9, real: 1 },
		theme,
		width,
	};
	const svg = execFileSync('node', ['--input-type=module', '-e', child], {
		encoding: 'utf8',
		env: { ...process.env, SPRAWL_INPUT: JSON.stringify(input) },
	});
	const rects = [...svg.matchAll(/<rect [^>]*>/g)].map(([tag]) => tag);

	return {
		svg,
		rects,
		bars: rects.filter((tag) => tag.includes('width="30.00" ')),
		squares: rects.filter((tag) => tag.includes('width="5.40" ')),
		lines: [...svg.matchAll(/<line [^>]*>/g)].map(([tag]) => tag),
		fontSizes: [...svg.matchAll(/font-size="(\d+)"/g)].map(([, size]) => size),
	};
};

describe('renderSprawlSvg', () => {
	test('frames the social-card size the README pairs its two renders at', () => {
		const { svg } = setupSvg();

		expect(svg.startsWith('<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">')).toBe(true);
	});

	test('scales every band whole, so the smaller pair is 800 × 420 and not a crop', () => {
		const { svg } = setupSvg({ width: 800 });

		expect(svg.startsWith('<svg xmlns="http://www.w3.org/2000/svg" width="800" height="420" viewBox="0 0 800 420">')).toBe(true);
	});

	test('scales the type with the frame, so the smaller pair reads the same', () => {
		const { fontSizes } = setupSvg({ width: 800 });

		// Caption, the per-frame line, then the counter — 20, 18 and 26 at full size.
		expect(fontSizes).toStrictEqual(['13', '12', '17']);
	});

	test('says the top lane never happened, in the image itself rather than in page copy', () => {
		const { svg } = setupSvg();

		expect(svg).toContain(
			'<text x="600" y="27" text-anchor="middle" font-family="Plus Jakarta Sans, sans-serif" font-weight="500" font-size="20" fill="#dddddd" fill-opacity="1">Top: the same commits with every split undone. Bottom: what actually happened.</text>',
		);
	});

	test('prints one pair of over-cap counts, the second of them in the brand gradient', () => {
		const { svg } = setupSvg();

		expect(svg).toContain(
			'<text x="600" y="614" text-anchor="middle" font-family="Plus Jakarta Sans, sans-serif" font-weight="600" font-size="26" fill="#dddddd" fill-opacity="1">files over cap: 9 → <tspan fill="url(#brand)">1</tspan></text>',
		);
	});

	test('declares the gradient that last number is painted from', () => {
		const { svg } = setupSvg();

		expect(svg).toContain(
			'<defs><linearGradient id="brand" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#000000"/><stop offset="1" stop-color="#ffffff"/></linearGradient></defs>',
		);
	});

	test('escapes a commit subject that would otherwise close the tag it sits in', () => {
		const { svg } = setupSvg({ subject: 'fix <Chart> & the R&D note' });

		expect(svg).toContain(
			'<text x="600" y="566" text-anchor="middle" font-family="JetBrains Mono, monospace" font-weight="400" font-size="18" fill="#446688" fill-opacity="0.4">abc1234 · 2026-01-01T00:00:00Z · fix &lt;Chart&gt; &amp; the R&amp;D note</text>',
		);
	});

	test('lays the ground over the whole frame before it draws anything on it', () => {
		const { rects } = setupSvg();

		expect(rects[0]).toBe('<rect x="0.00" y="0.00" width="1200.00" height="630.00" fill="#101010" fill-opacity="1"/>');
	});

	test('reddens a file past the plain cap, wherever in the history it is drawn', () => {
		const { bars } = setupSvg();

		// The 400-line `.ts` at the head of the real lane, full height against a
		// 400-line scale, sitting at the second lane's top edge.
		expect(bars.filter((tag) => fillOf({ tag }) === '#ee0000')).toStrictEqual([
			'<rect x="0.00" y="300.00" width="30.00" height="168.00" fill="#ee0000" fill-opacity="1"/>',
		]);
	});

	test('measures a .tsx against the .tsx cap, so 280 lines is not over', () => {
		const { bars } = setupSvg();

		// The counterfactual lane's only bar: over the 250-line file cap, under
		// the 300-line one its extension earns it, and therefore not red.
		expect(bars[0]).toBe('<rect x="0.00" y="90.40" width="30.00" height="117.60" fill="#000000" fill-opacity="1"/>');
	});

	test('walks the bars along the brand gradient by index, which the page deliberately does not', () => {
		const { bars } = setupSvg();

		// The real lane's three bars, of which the first is red for being over cap.
		expect(bars.slice(1).map((tag) => fillOf({ tag }))).toStrictEqual(['#ee0000', '#808080', '#ffffff']);
	});

	test('draws an under-cap folder row in the muted colour at its own alpha', () => {
		const { squares } = setupSvg();

		expect(squares[0]).toBe('<rect x="0.00" y="209.80" width="5.40" height="5.40" fill="#446688" fill-opacity="0.4"/>');
	});

	test('reddens every square of a folder past the census cap, at full alpha', () => {
		const { squares } = setupSvg();

		// Three entries against a cap of two, laid out with a quarter-edge gap.
		expect(squares.slice(1)).toStrictEqual([
			'<rect x="0.00" y="469.80" width="5.40" height="5.40" fill="#ee0000" fill-opacity="1"/>',
			'<rect x="6.75" y="469.80" width="5.40" height="5.40" fill="#ee0000" fill-opacity="1"/>',
			'<rect x="13.50" y="469.80" width="5.40" height="5.40" fill="#ee0000" fill-opacity="1"/>',
		]);
	});

	test('holds the cap line at one height in both lanes, so the two are read against one scale', () => {
		const { lines } = setupSvg();

		// 260 px apart: the 240-px lane below plus the 20-px gap between them, and
		// nothing else — the same fraction of each lane's own box.
		expect([lines[0], lines[2]]).toStrictEqual([
			'<line x1="0.00" y1="103.00" x2="1200.00" y2="103.00" stroke="#446688" stroke-opacity="0.4" stroke-width="1.80"/>',
			'<line x1="0.00" y1="363.00" x2="1200.00" y2="363.00" stroke="#446688" stroke-opacity="0.4" stroke-width="1.80"/>',
		]);
	});

	test('stands the census line where the cap-th folder square would begin', () => {
		const { lines } = setupSvg();

		// Vertical, spanning the folder strip only, at the x the third square of an
		// over-cap row lands on — which is what makes the row read as over cap.
		expect(lines[1]).toBe('<line x1="13.50" y1="209.80" x2="13.50" y2="280.00" stroke="#446688" stroke-opacity="0.4" stroke-width="1.80"/>');
	});
});
