import { describe, expect, test } from '@jest/globals';
import { render, screen } from '@testing-library/react';
import { Sparkles } from 'lucide-react';
import { SectionPill } from '#src/features/home/components/SectionPill.tsx';

describe('SectionPill', () => {
	test('says what the section is about', () => {
		render(<SectionPill icon={Sparkles} label="Cleans as it codes" />);

		expect(screen.getByText('Cleans as it codes')).toHaveClass('uppercase');
	});

	test('keeps its icon out of what a screen reader hears', () => {
		const { container } = render(<SectionPill icon={Sparkles} label="label" />);

		expect(container.querySelector('svg')).toHaveAttribute('aria-hidden', 'true');
	});

	test('takes a class from the section it opens', () => {
		const { container } = render(<SectionPill icon={Sparkles} label="label" className="mb-10" />);

		expect(container.firstElementChild).toHaveClass('mb-10');
	});

	test('takes a label with logos inline, each beside the name it belongs to', () => {
		const { container } = render(
			<SectionPill
				label={
					<>
						<svg data-logo="linear" /> Linear
					</>
				}
			/>,
		);

		expect({ logo: container.querySelector('[data-logo="linear"]') !== null, text: container.textContent }).toStrictEqual({ logo: true, text: ' Linear' });
	});
});
