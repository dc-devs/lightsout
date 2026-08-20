import { type ClassValue, clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

/** Merge conditional class names, letting a later Tailwind utility win over an earlier one. */
export const cn = (...inputs: ClassValue[]): string => twMerge(clsx(inputs));
