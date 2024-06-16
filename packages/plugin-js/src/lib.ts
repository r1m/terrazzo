import type { Token, TokenNormalized, TokenTransformed } from '@terrazzo/parser';

export const FORMAT_JS_ID = 'js';
export const FORMAT_DTS_ID = 'd.ts';

export interface JSPluginOptions {
  /** output JS? (default: true) */
  js?: boolean | string;
  /** output JSON? (default: false) */
  json?: boolean | string;
  /** exclude token IDs from output? */
  exclude?: string[];
  /** return deeply-nested values? (default: false) */
  deep?: boolean;
  /** Override certain token values */
  transform?: (token: TokenNormalized, mode: string) => TokenTransformed['value'];
}

export const FILE_HEADER = `/** ------------------------------------------
 *  Autogenerated by ⛋ Terrazzo. DO NOT EDIT!
 * ------------------------------------------- */`;

export const TYPE_MAP: Record<Token['$type'], string> = {
  boolean: 'BooleanTokenNormalized',
  border: 'BorderTokenNormalized',
  color: 'ColorTokenNormalized',
  cubicBezier: 'CubicBezierTokenNormalized',
  dimension: 'DimensionTokenNormalized',
  duration: 'DurationTokenNormalized',
  fontFamily: 'FontFamilyTokenNormalized',
  fontWeight: 'FontWeightTokenNormalized',
  gradient: 'GradientTokenNormalized',
  link: 'LinkTokenNormalized',
  number: 'NumberTokenNormalized',
  shadow: 'ShadowTokenNormalized',
  string: 'StringTokenNormalized',
  strokeStyle: 'StrokeStyleTokenNormalized',
  typography: 'TypographyTokenNormalized',
  transition: 'TransitionTokenNormalized',
};
