import { describe, expect, jest, test } from '@jest/globals';
import { fireEvent, render, screen } from '@testing-library/react';
import { Button } from '#src/appUI/Button.tsx';

const setupButton = ({
	variant,
	size,
	asChild = false,
	className,
}: {
	variant?: 'default' | 'ghost' | 'outline' | 'brand';
	size?: 'sm' | 'icon';
	asChild?: boolean;
	className?: string;
} = {}) => {
	const onClick = jest.fn<() => void>();

	render(
		asChild ? (
			<Button asChild variant={variant} size={size} className={className}>
				<a href="/runs">Open</a>
			</Button>
		) : (
			<Button variant={variant} size={size} className={className} onClick={onClick}>
				Open
			</Button>
		),
	);

	return { onClick };
};

describe('Button', () => {
	test('renders a button element carrying its label', () => {
		setupButton();

		const button = screen.getByRole('button', { name: 'Open' });

		expect(button).toBeInTheDocument();
	});

	test('calls the click handler it was given', () => {
		const { onClick } = setupButton();

		fireEvent.click(screen.getByRole('button', { name: 'Open' }));

		expect(onClick).toHaveBeenCalledTimes(1);
	});

	test('carries the ghost variant and small size onto the element', () => {
		setupButton({ variant: 'ghost', size: 'sm' });

		const button = screen.getByRole('button', { name: 'Open' });

		expect(button.className).toContain('hover:bg-accent');
	});

	test('renders the caller own element when asChild is set, so a link can look like a button', () => {
		setupButton({ asChild: true, variant: 'outline', size: 'icon' });

		const link = screen.getByRole('link', { name: 'Open' });

		expect(link).toHaveAttribute('data-slot', 'button');
	});

	test('carries the outline variant and icon size onto the element the caller supplied', () => {
		setupButton({ asChild: true, variant: 'outline', size: 'icon' });

		const link = screen.getByRole('link', { name: 'Open' });

		expect(link.className).toContain('size-9');
	});

	test('falls back to the filled variant and the standard height when neither is given', () => {
		setupButton();

		const button = screen.getByRole('button', { name: 'Open' });

		expect(button.className.split(' ')).toEqual(expect.arrayContaining(['bg-primary', 'h-9']));
	});

	test('lets a caller class replace the background the variant chose, rather than printing both', () => {
		setupButton({ className: 'bg-transparent' });

		const classes = screen.getByRole('button', { name: 'Open' }).className.split(' ');

		expect(classes).toEqual(expect.arrayContaining(['bg-transparent']));
		expect(classes).not.toContain('bg-primary');
	});

	test('paints the call to action with the one brand gradient rather than a colour of its own', () => {
		setupButton({ variant: 'brand' });

		const button = screen.getByRole('button', { name: 'Open' });

		expect(button.className).toContain('bg-[image:var(--brand-gradient)]');
	});

	test.each<{ variant: 'default' | 'outline' }>([{ variant: 'default' }, { variant: 'outline' }])('leaves the $variant button flat', ({ variant }) => {
		setupButton({ variant });

		const classes = screen.getByRole('button', { name: 'Open' }).className.split(' ');

		expect(classes).not.toContain('shadow-xs');
	});
});
