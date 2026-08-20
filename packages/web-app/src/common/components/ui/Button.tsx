import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';
import type { ComponentProps } from 'react';
import { cn } from '#src/common/utils/cn.ts';

// Unexported on purpose. The upstream shadcn file publishes its variants beside
// the component, which this repo's one-export-per-file rule forbids; a caller
// that needs a button-shaped link reaches for `asChild` instead.
const buttonVariants = cva(
	'inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium transition-all shrink-0 outline-none disabled:pointer-events-none disabled:opacity-50 focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px] [&_svg]:pointer-events-none [&_svg]:shrink-0',
	{
		variants: {
			variant: {
				default: 'bg-primary text-primary-foreground shadow-xs hover:bg-primary-hover',
				ghost: 'hover:bg-accent hover:text-accent-foreground',
				outline: 'border bg-background shadow-xs hover:bg-accent hover:text-accent-foreground',
			},
			size: {
				default: 'h-9 px-4 py-2',
				sm: 'h-8 gap-1.5 rounded-md px-3',
				icon: 'size-9',
			},
		},
		defaultVariants: { variant: 'default', size: 'default' },
	},
);

interface Props extends ComponentProps<'button'> {
	variant?: VariantProps<typeof buttonVariants>['variant'];
	size?: VariantProps<typeof buttonVariants>['size'];
	/** Render the caller's own child element with the button's styling — a link that has to look like a button. */
	asChild?: boolean;
}

export const Button = ({ className, variant, size, asChild = false, ...rest }: Props) => {
	const Component = asChild ? Slot : 'button';

	return <Component data-slot="button" className={cn(buttonVariants({ variant, size }), className)} {...rest} />;
};
