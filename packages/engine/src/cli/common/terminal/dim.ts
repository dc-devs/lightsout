import { paint } from '#src/cli/common/terminal/paint.ts';

export const dim: (text: string) => string = paint({ code: '2' });
