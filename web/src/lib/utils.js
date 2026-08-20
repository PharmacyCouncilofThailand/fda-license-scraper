import { clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

/** shadcn's class merger: conditional classes in, last Tailwind rule wins. */
export function cn(...inputs) {
  return twMerge(clsx(inputs));
}
