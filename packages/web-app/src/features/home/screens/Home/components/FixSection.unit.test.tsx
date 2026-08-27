import { describe, expect, test } from '@jest/globals';
import { render, screen } from '@testing-library/react';
import { FixSection } from '#src/features/home/screens/Home/components/FixSection.tsx';

describe('FixSection', () => {
	test('states who decides what, which is the whole product in one line', () => {
		render(<FixSection />);

		expect(screen.getByRole('heading', { level: 2, name: 'Humans decide. Agents execute. Your commands decide when it’s done.' })).toBeInTheDocument();
	});

	test('offers a tab per shipped workflow graphic', () => {
		render(<FixSection />);

		const tabs = screen.getAllByRole('tab').map((tab) => tab.textContent);

		expect(tabs).toStrictEqual(['brainstorm · plan', 'implement', 'refactor']);
	});

	test('ships each graphic twice, so the theme picks one in CSS rather than in JavaScript', () => {
		render(<FixSection />);

		const images = screen.getAllByAltText('The brainstorm and plan commands, step by step');

		expect(images.map((image) => image.className.includes('dark:hidden'))).toStrictEqual([true, false]);
	});
});
