import { paint } from '#src/cli/common/terminal/paint.ts';

export const yellow: (text: string) => string = paint({ code: '33' });
