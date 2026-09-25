import { paint } from '#src/cli/internal/common/terminal/paint.ts';

export const green: (text: string) => string = paint({ code: '32' });
