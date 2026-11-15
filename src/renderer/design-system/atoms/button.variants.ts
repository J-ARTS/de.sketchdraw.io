import { cva, type VariantProps } from 'class-variance-authority';

/**
 * The looks of a text button. The classes live in `src/renderer/styles/base.css`; this table is the one place
 * that says which looks exist, so a look that is not listed here is a type error instead of a new one-off class.
 */
export const buttonVariants = cva('sd-btn', {
  variants: {
    /** `neutral` for ordinary actions, `primary` for the one main action of a view, `danger` for deleting and discarding. */
    intent: { neutral: '', primary: 'sd-btn--primary', danger: 'sd-btn--danger' },
  },
  defaultVariants: { intent: 'neutral' },
});
export type ButtonVariants = VariantProps<typeof buttonVariants>;
export type ButtonIntent = NonNullable<ButtonVariants['intent']>;
