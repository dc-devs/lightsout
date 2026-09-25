import { paint } from '#src/cli/internal/common/terminal/paint.ts';

export const dim: (text: string) => string = paint({ code: '2' });
