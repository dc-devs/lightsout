import { expect, test } from '@jest/globals';
import { excludedSourcePaths } from '#src/common/sourceFiles/excludedSourcePaths.ts';

test('excludedSourcePaths: both config keys are excluded, generated first', () => {
	const excluded = excludedSourcePaths({ config: { generated: ['src/gen/'], vendored: ['src/common/components/ui/'] } });

	expect(excluded).toStrictEqual(['src/gen/', 'src/common/components/ui/']);
});

test('excludedSourcePaths: a config naming only generated paths excludes only those', () => {
	const excluded = excludedSourcePaths({ config: { generated: ['src/gen/'] } });

	expect(excluded).toStrictEqual(['src/gen/']);
});

test('excludedSourcePaths: a config naming only vendored paths excludes only those', () => {
	const excluded = excludedSourcePaths({ config: { vendored: ['vendor/'] } });

	expect(excluded).toStrictEqual(['vendor/']);
});

test('excludedSourcePaths: a config naming neither key excludes nothing', () => {
	const excluded = excludedSourcePaths({ config: {} });

	expect(excluded).toStrictEqual([]);
});

test('excludedSourcePaths: no config at all excludes nothing, so a caller that could not read one still walks', () => {
	const excluded = excludedSourcePaths({});

	expect(excluded).toStrictEqual([]);
});
