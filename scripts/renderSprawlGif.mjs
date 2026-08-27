import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Resvg } from '@resvg/resvg-js';
import gifenc from 'gifenc';
import { buildSprawlFrameSchedule } from '../packages/web-app/src/features/sprawl/common/rendering/buildSprawlFrameSchedule.ts';
import { buildSprawlLaneStates } from '../packages/web-app/src/features/sprawl/common/rendering/buildSprawlLaneStates.ts';
import { getSprawlMaxLines } from '../packages/web-app/src/features/sprawl/common/rendering/getSprawlMaxLines.ts';
import { invokedDirectly } from './invokedDirectly.mjs';
import { renderSprawlSvg } from './renderSprawlSvg.mjs';
import { runScript } from './runScript.mjs';

/**
 * Renders `assets/sprawl-dataset.json` to the two README GIFs.
 *
 * The image and the page draw one geometry: this script imports the same
 * `buildSprawlLayout`, `buildSprawlLaneStates` and `getSprawlMaxLines` the
 * component uses, builds the component's SVG as a string, and rasterises it.
 * There is no second copy of the drawing to keep in step, which is the only way
 * a README image stays true after the page changes.
 *
 * Colours are hex literals here, and this is the one place in this feature that
 * is legitimate: a Node script writing pixels cannot resolve a Tailwind token,
 * and the guardrail test that bans literals scans `packages/web-app/src` only.
 *
 * Like the dataset, this is an author-built committed artefact. CI never
 * rebuilds it, so the fonts coming from the author's machine is fine.
 */
const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');

/** The two renders. The light one is the README's `<img>` fallback, the dark one its dark-scheme `<source>`. */
const themes = [
	{ file: 'sprawl.gif', ground: '#0d1524', barFrom: '#35d6e8', barTo: '#b06bf5', muted: '#d3dfef', mutedOpacity: 0.4, overCap: '#e5484d', text: '#d3dfef' },
	{
		file: 'sprawl-light.gif',
		ground: '#f6f8fb',
		barFrom: '#0e93ad',
		barTo: '#7c3aed',
		muted: '#1f2937',
		mutedOpacity: 0.4,
		overCap: '#c62a2f',
		text: '#374151',
	},
];

/** A README image has a weight limit in practice; past it the smaller pair is rendered instead. */
const maxBytes = 3 * 1024 * 1024;

/**
 * The frames the GIF keeps: evenly spaced, but never at the cost of a refactor
 * marker, the first frame or the last.
 *
 * A marker is where a move happens, which is the whole point of the image — an
 * even sample that dropped one would be showing the outcome with the cause
 * edited out.
 */
const sampleFrames = ({ frames, target }) => {
	if (frames.length <= target) {
		return frames.map((_unused, index) => index);
	}

	const kept = new Set([0, frames.length - 1]);

	frames.forEach((frame, index) => {
		if (frame.isRefactorMarker) {
			kept.add(index);
		}
	});

	for (let step = 0; step < target && kept.size < target; step += 1) {
		kept.add(Math.round((step * (frames.length - 1)) / (target - 1)));
	}

	return [...kept].sort((left, right) => left - right);
};

/** One frame's RGBA pixels, at the size the GIF is being written at. */
const rasterise = ({ svg, width }) => {
	const rendered = new Resvg(svg, {
		fitTo: { mode: 'width', value: width },
		font: { loadSystemFonts: true, defaultFontFamily: 'JetBrains Mono' },
		logLevel: 'error',
	}).render();

	return { pixels: rendered.pixels, width: rendered.width, height: rendered.height };
};

/**
 * One theme's GIF.
 *
 * The palette is quantised once over a handful of frames and written as the
 * global colour table, rather than per frame: a local table on every frame
 * would add a kilobyte apiece for colours that never change. Consecutive
 * repeats of the same frame — a held marker, the held last frame — reuse the
 * pixels already indexed instead of rasterising again.
 */
const encodeGif = ({ dataset, theme, width, kept, schedule }) => {
	const { GIFEncoder, quantize, applyPalette } = gifenc;
	const states = {
		with: buildSprawlLaneStates({ dataset, lane: 'with' }),
		without: buildSprawlLaneStates({ dataset, lane: 'without' }),
	};
	const maxLines = getSprawlMaxLines({ dataset });
	const last = dataset.frames[dataset.frames.length - 1];
	const counter = { without: last.without.overCap, real: last.with.overCap };
	const draw = ({ index }) => {
		const frame = dataset.frames[kept[index]];
		const svg = renderSprawlSvg({
			withState: states.with[kept[index]],
			withoutState: states.without[kept[index]],
			maxLines,
			caps: dataset.caps,
			frame,
			counter,
			theme,
			width,
		});

		return rasterise({ svg, width });
	};

	const sample = [0, Math.floor(kept.length / 3), Math.floor((kept.length * 2) / 3), kept.length - 1].map((index) => draw({ index }));
	const palette = quantize(Buffer.concat(sample.map(({ pixels }) => pixels)), 256);
	const gif = GIFEncoder();
	const { height } = sample[0];
	let drawnIndex = -1;
	let indexed;

	schedule.forEach((index, position) => {
		if (index !== drawnIndex) {
			indexed = applyPalette(draw({ index }).pixels, palette);
			drawnIndex = index;
		}

		// 83 ms is twelve a second, the rate `useSprawlFrameLoop` plays the page at.
		gif.writeFrame(indexed, width, height, position === 0 ? { palette, delay: 83, repeat: 0 } : { delay: 83 });
	});

	gif.finish();

	return { bytes: gif.bytes(), height };
};

/** @param log - where progress goes; the caller owns the console */
export const renderSprawlGif = ({ log = console.log } = {}) => {
	const dataset = JSON.parse(readFileSync(join(repoRoot, 'assets', 'sprawl-dataset.json'), 'utf8'));
	const kept = sampleFrames({ frames: dataset.frames, target: 120 });
	const frames = kept.map((index) => dataset.frames[index]);
	// The last frame is held for two seconds so a reader lands on the outcome
	// rather than on whatever the loop happened to restart over.
	const schedule = [...buildSprawlFrameSchedule({ frames }), ...Array.from({ length: 24 }, () => kept.length - 1)];

	log(`sampled ${kept.length} of ${dataset.frames.length} frames, ${frames.filter((frame) => frame.isRefactorMarker).length} of them refactor markers`);
	log(`encoding ${schedule.length} frames at 12 fps`);

	for (const width of [1200, 800]) {
		const written = themes.map((theme) => ({ theme, ...encodeGif({ dataset, theme, width, kept, schedule }) }));
		const over = written.filter(({ bytes }) => bytes.length > maxBytes);

		for (const { theme, bytes, height } of written) {
			log(`${theme.file}: ${width} × ${height}, ${(bytes.length / 1024 / 1024).toFixed(2)} MB${bytes.length > maxBytes ? ' — over the 3 MB budget' : ''}`);
		}

		if (over.length === 0) {
			for (const { theme, bytes } of written) {
				writeFileSync(join(repoRoot, 'assets', theme.file), bytes);
			}

			return written.map(({ theme, bytes }) => ({ file: theme.file, bytes: bytes.length }));
		}

		// Both are re-rendered, never just the heavy one: the README pairs them in
		// one `<picture>`, and two GIFs of different sizes would jump as the reader
		// switched colour scheme.
		log(`${over.length} render(s) over budget at ${width} px — falling back to the smaller pair`);
	}

	throw new Error('both renders exceed the 3 MB budget even at 800 × 420 — cut frames rather than commit a README image that large');
};

if (invokedDirectly({ moduleUrl: import.meta.url })) {
	runScript({ run: renderSprawlGif });
}
