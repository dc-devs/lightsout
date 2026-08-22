import { describe, expect, test } from '@jest/globals';
import { render, screen } from '@testing-library/react';
import { MetadataTag } from '#src/appUI/MetadataTag.tsx';

const setupMetadataTag = ({ className, title }: { className?: string; title?: string } = {}) => {
	render(
		<MetadataTag className={className} title={title}>
			a3808d03
		</MetadataTag>,
	);
};

describe('MetadataTag', () => {
	test('renders the identifier it was given', () => {
		setupMetadataTag();

		const tag = screen.getByText('a3808d03');

		expect(tag).toBeInTheDocument();
	});

	test('sets it in the mono face, which is what marks it as machine truth', () => {
		setupMetadataTag();

		const tag = screen.getByText('a3808d03');

		expect(tag.className).toContain('font-mono');
	});

	test('renders inline, so a tag can sit inside a sentence', () => {
		setupMetadataTag();

		const tag = screen.getByText('a3808d03');

		expect(tag.tagName).toBe('SPAN');
	});

	test('carries a tooltip for a value it has to truncate', () => {
		setupMetadataTag({ title: '/repos/lightsout' });

		const tag = screen.getByTitle('/repos/lightsout');

		expect(tag).toBeInTheDocument();
	});

	test('leaves the tooltip off when no title was given, so hovering pops nothing', () => {
		setupMetadataTag();

		const tag = screen.getByText('a3808d03');

		expect(tag).not.toHaveAttribute('title');
	});

	test('lets a caller class through', () => {
		setupMetadataTag({ className: 'max-w-40' });

		const tag = screen.getByText('a3808d03');

		expect(tag.className).toContain('max-w-40');
	});

	test('lets a caller class win over the default it conflicts with', () => {
		setupMetadataTag({ className: 'px-3' });

		const tag = screen.getByText('a3808d03');

		expect(tag.className).toContain('px-3');
		expect(tag.className).not.toContain('px-1.5');
	});
});
