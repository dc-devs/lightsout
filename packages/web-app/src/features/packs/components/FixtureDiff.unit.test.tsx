import { describe, expect, test } from '@jest/globals';
import { FixtureSide, type StandardsPackFixture } from '@lightsout/engine';
import { render, screen } from '@testing-library/react';
import { FixtureDiff } from '#src/features/packs/components/FixtureDiff.tsx';

const failFixture: StandardsPackFixture = { side: FixtureSide.Fail, path: 'src/readLabel.ts', text: 'return (value as string).toUpperCase();' };
const passFixture: StandardsPackFixture = { side: FixtureSide.Pass, path: 'src/readLabel.ts', text: "if (typeof value === 'string') {}" };

const setupFixtureDiff = ({ fixtures = [failFixture, passFixture] }: { fixtures?: StandardsPackFixture[] } = {}) => {
	render(<FixtureDiff fixtures={fixtures} />);
};

describe('FixtureDiff', () => {
	test('says the pack shipped without its fixtures when there is nothing to show, rather than drawing two empty columns', () => {
		setupFixtureDiff({ fixtures: [] });

		const notice = screen.getByText('This pack shipped without its fixtures.');

		expect(notice).toBeInTheDocument();
	});

	test('shows both sides of the proof, each verbatim, because the comments in a fixture are half of what it teaches', () => {
		setupFixtureDiff();

		expect(screen.getByText('return (value as string).toUpperCase();')).toBeInTheDocument();
		expect(screen.getByText("if (typeof value === 'string') {}")).toBeInTheDocument();
	});

	test('names the one file each side holds, so a reader knows where the example would live', () => {
		setupFixtureDiff();

		const paths = screen.getAllByText('src/readLabel.ts');

		expect(paths).toHaveLength(2);
	});

	test('keeps the empty column and says what is missing when a rule only argues one way', () => {
		setupFixtureDiff({ fixtures: [failFixture] });

		const placeholder = screen.getByText('no pass example');

		expect(placeholder).toBeInTheDocument();
	});

	test('says the same the other way round, since the absence is information either way', () => {
		setupFixtureDiff({ fixtures: [passFixture] });

		const placeholder = screen.getByText('no fail example');

		expect(placeholder).toBeInTheDocument();
	});

	test('gives a side holding more than one file a tab per file, keyed by its path', () => {
		setupFixtureDiff({
			fixtures: [failFixture, { side: FixtureSide.Fail, path: 'src/other.ts', text: 'const x = y as z;' }, passFixture],
		});

		const tabs = screen.getAllByRole('tab').map((tab) => tab.textContent);

		expect(tabs).toStrictEqual(['src/readLabel.ts', 'src/other.ts']);
	});

	test('shows the first of those files without a reader having to pick one', () => {
		setupFixtureDiff({
			fixtures: [failFixture, { side: FixtureSide.Fail, path: 'src/other.ts', text: 'const x = y as z;' }, passFixture],
		});

		const code = screen.getByText('return (value as string).toUpperCase();');

		expect(code).toBeInTheDocument();
	});
});
