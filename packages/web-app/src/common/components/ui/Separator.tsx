import * as SeparatorPrimitive from '@radix-ui/react-separator';
import type { ComponentProps } from 'react';
import { cn } from '#src/common/utils/cn.ts';

/** A hairline rule in the theme's border colour, horizontal unless told otherwise. */
export const Separator = ({ className, orientation = 'horizontal', decorative = true, ...rest }: ComponentProps<typeof SeparatorPrimitive.Root>) => (
	<SeparatorPrimitive.Root
		data-slot="separator"
		decorative={decorative}
		orientation={orientation}
		className={cn(
			'shrink-0 bg-border data-[orientation=horizontal]:h-px data-[orientation=horizontal]:w-full data-[orientation=vertical]:h-full data-[orientation=vertical]:w-px',
			className,
		)}
		{...rest}
	/>
);
