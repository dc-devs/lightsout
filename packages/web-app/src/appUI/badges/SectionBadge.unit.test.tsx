import { describe, expect, test } from '@jest/globals';
import { render, screen } from '@testing-library/react';
import { SectionBadge } from '#src/appUI/badges/SectionBadge.tsx';

const setupSectionBadge = () => {
	render(<SectionBadge>The proof</SectionBadge>);
};

describe('SectionBadge', () => {
	test('renders the eyebrow it was given', () => {
		setupSectionBadge();

		const badge = screen.getByText('The proof');

		expect(badge).toBeInTheDocument();
	});

	test('sets it apart from the heading below by casing it up', () => {
		setupSectionBadge();

		const badge = screen.getByText('The proof');

		expect(badge.className).toContain('uppercase');
	});
});
