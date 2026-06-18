/**
 * Static light palette — prefer `useTheme()` in components for dark mode support.
 */
import { lightColors, type AppColors } from './palettes';

export type Colors = AppColors;
export type { AppColors };
export { lightColors, darkColors } from './palettes';
export const colors = lightColors;
