import { paint } from '#src/cli/internal/common/terminal/paint.ts';

export const yellow: (text: string) => string = paint({ code: '33' });
