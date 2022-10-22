import type {
  BuildResult,
  GradientStop,
  ParsedBorderToken,
  ParsedColorToken,
  ParsedCubicBezierToken,
  ParsedDimensionToken,
  ParsedDurationToken,
  ParsedFontToken,
  ParsedGradientToken,
  ParsedLinkToken,
  ParsedShadowToken,
  ParsedStrokeStyleToken,
  ParsedToken,
  ParsedTransitionToken,
  ParsedTypographyToken,
  Plugin,
  ResolvedConfig,
} from '@cobalt-ui/core';
import color from 'better-color-tools';
import {indent, kebabinate, FG_YELLOW, RESET} from '@cobalt-ui/utils';
import {encode, formatFontNames} from './util.js';

const DASH_PREFIX_RE = /^-+/;
const DASH_SUFFIX_RE = /-+$/;
const DOT_UNDER_GLOB_RE = /[._]/g;
const SELECTOR_BRACKET_RE = /\s*{/;
const HEX_RE = /#[0-9a-f]{3,8}/g;

export interface Options {
  /** output file (default: "./tokens/tokens.css") */
  filename?: string;
  /** embed files in CSS? */
  embedFiles?: boolean;
  /** generate wrapper selectors around token modes */
  modeSelectors?: Record<string, string | string[]>;
  /** handle different token types */
  transform?: (token: ParsedToken, mode?: string) => string;
  /** prefix variable names */
  prefix?: string;
}

export default function pluginCSS(options?: Options): Plugin {
  let config: ResolvedConfig;
  let filename = options?.filename || './tokens.css';
  let prefix = options?.prefix ? `${options.prefix.replace(DASH_PREFIX_RE, '').replace(DASH_SUFFIX_RE, '')}-` : '';

  function makeVars(tokens: Record<string, any>, indentLv = 0, generateRoot = false): string[] {
    const output: string[] = [];
    if (generateRoot) output.push(indent(':root {', indentLv));
    for (const [id, value] of Object.entries(tokens)) {
      output.push(indent(`--${prefix}${id.replace(DOT_UNDER_GLOB_RE, '-')}: ${value};`, indentLv + (generateRoot ? 1 : 0)));
    }
    if (generateRoot) output.push(indent('}', indentLv));
    return output;
  }

  function makeP3(input: string[]): string[] {
    const output: string[] = [];
    for (const line of input) {
      if (line.includes('{') || line.includes('}')) {
        output.push(line);
        continue;
      }
      const matches = line.match(HEX_RE);
      if (!matches || !matches.length) continue;
      let newVal = line;
      for (const c of matches) {
        newVal = newVal.replace(c, color.from(c).p3);
      }
      output.push(newVal);
    }
    return output;
  }

  return {
    name: '@cobalt-ui/plugin-css',
    config(c): void {
      config = c;
    },
    async build({tokens, metadata}): Promise<BuildResult[]> {
      const tokenVals: {[id: string]: any} = {};
      const modeVals: {[selector: string]: {[id: string]: any}} = {};
      const selectors: string[] = [];

      // transformation (1 pass through all tokens + modes)
      // note: async transforms aren’t documented, but allow it just in case a user needs it
      for (const token of tokens) {
        let value = (typeof options?.transform === 'function' && (await options.transform(token))) || defaultTransformer(token);
        switch (token.$type) {
          case 'link': {
            if (options?.embedFiles) value = encode(value as string, config.outDir);
            tokenVals[token.id] = value;
            break;
          }
          case 'typography': {
            for (const [k, v] of Object.entries(value)) {
              tokenVals[`${token.id}-${k}`] = v;
            }
            break;
          }
          default: {
            tokenVals[token.id] = value;
            break;
          }
        }

        if (token.$extensions && token.$extensions.mode && options?.modeSelectors) {
          for (let [modeID, modeSelectors] of Object.entries(options.modeSelectors)) {
            const [groupRoot, modeName] = parseModeSelector(modeID);
            if ((groupRoot && !token.id.startsWith(groupRoot)) || !token.$extensions.mode[modeName]) continue;
            if (!Array.isArray(selectors)) modeSelectors = [selectors];
            for (const selector of modeSelectors) {
              if (!selectors.includes(selector)) selectors.push(selector);
              if (!modeVals[selector]) modeVals[selector] = {};
              let modeVal = (typeof options?.transform === 'function' && (await options.transform(token, modeName))) || defaultTransformer(token, modeName);
              switch (token.$type) {
                case 'link': {
                  if (options?.embedFiles) modeVal = encode(modeVal as string, config.outDir);
                  modeVals[selector][token.id] = modeVal;
                  break;
                }
                case 'typography': {
                  for (const [k, v] of Object.entries(modeVal)) {
                    modeVals[selector][`${token.id}-${k}`] = v;
                  }
                  break;
                }
                default: {
                  modeVals[selector][token.id] = modeVal;
                  break;
                }
              }
            }
          }
        }
      }

      // :root vars
      let code: string[] = [];
      code.push('/**');
      code.push(` * ${metadata.name || 'Design Tokens'}`);
      code.push(' * Autogenerated from tokens.json.');
      code.push(' * DO NOT EDIT!');
      code.push(' */');
      code.push('');
      code.push(...makeVars(tokenVals, 0, true));

      // modes
      for (const selector of selectors) {
        code.push('');
        if (!Object.keys(modeVals[selector]).length) {
          // eslint-disable-next-line no-console
          console.warn(`${FG_YELLOW}@cobalt-ui/plugin-css${RESET} can’t find any tokens for "${selector}"`);
          continue;
        }
        const wrapper = selector.trim().replace(SELECTOR_BRACKET_RE, '');
        code.push(`${wrapper} {`);
        if (modeVals[selector]) code.push(...makeVars(modeVals[selector], 1, wrapper.startsWith('@')));
        code.push('}');
      }

      // P3
      if (tokens.some((t) => t.$type === 'color' || t.$type === 'gradient' || t.$type === 'shadow')) {
        code.push('');
        code.push(indent(`@supports (color: color(display-p3 1 1 1)) {`, 0)); // note: @media (color-gamut: p3) is problematic in most browsers
        code.push(...makeP3(makeVars(tokenVals, 1, true)));
        for (const selector of selectors) {
          code.push('');
          const wrapper = selector.trim().replace(SELECTOR_BRACKET_RE, '');
          code.push(indent(`${wrapper} {`, 1));
          code.push(...makeP3(makeVars(modeVals[selector], 2, wrapper.startsWith('@'))));
          code.push(indent('}', 1));
        }
        code.push(indent('}', 0));
      }

      code.push('');

      return [
        {
          filename,
          contents: code.join('\n'),
        },
      ];
    },
  };
}

/** transform color */
export function transformColor(value: ParsedColorToken['$value']): string {
  return String(value);
}
/** transform dimension */
export function transformDimension(value: ParsedDimensionToken['$value']): string {
  return String(value);
}
/** transform duration */
export function transformDuration(value: ParsedDurationToken['$value']): string {
  return String(value);
}
/** transform font */
export function transformFont(value: ParsedFontToken['$value']): string {
  return formatFontNames(value);
}
/** transform cubic beziér */
export function transformCubicBezier(value: ParsedCubicBezierToken['$value']): string {
  return `cubic-bezier(${value.join(', ')})`;
}
/** transform file */
export function transformLink(value: ParsedLinkToken['$value']): string {
  return `url('${value}')`;
}
/** transform stroke style */
export function transformStrokeStyle(value: ParsedStrokeStyleToken['$value']): string {
  return String(value);
}
/** transform border */
export function transformBorder(value: ParsedBorderToken['$value']): string {
  return [transformDimension(value.width), transformStrokeStyle(value.style), transformColor(value.color)].join(' ');
}
/** transform shadow */
export function transformShadow(value: ParsedShadowToken['$value']): string {
  return [value.offsetX, value.offsetY, value.blur, value.spread, value.color].join(' ');
}
/** transform gradient */
export function transformGradient(value: ParsedGradientToken['$value']): string {
  return value.map((g: GradientStop) => `${g.color} ${g.position * 100}%`).join(', ');
}
/** transform transition */
export function transformTransition(value: ParsedTransitionToken['$value']): string {
  const timingFunction = value.timingFunction ? `cubic-bezier(${value.timingFunction.join(',')})` : undefined;
  return [value.duration, value.delay, timingFunction].filter((v) => v !== undefined).join(' ');
}
/** transform typography */
export function transformTypography(value: ParsedTypographyToken['$value']): Record<string, string | number | string[]> {
  const values: Record<string, string | number | string[]> = {};
  for (const [k, v] of Object.entries(value)) {
    values[kebabinate(k)] = Array.isArray(v) ? formatFontNames(v) : (v as any);
  }
  return values;
}

export function defaultTransformer(token: ParsedToken, mode?: string): string | ReturnType<typeof transformTypography> {
  if (mode && (!token.$extensions?.mode || !token.$extensions.mode[mode])) throw new Error(`Token ${token.id} missing "$extensions.mode.${mode}"`);
  switch (token.$type) {
    case 'color':
      return transformColor(mode ? ((token.$extensions as any).mode[mode] as typeof token.$value) : token.$value);
    case 'dimension':
      return transformDimension(mode ? ((token.$extensions as any).mode[mode] as typeof token.$value) : token.$value);
    case 'duration':
      return transformDuration(mode ? ((token.$extensions as any).mode[mode] as typeof token.$value) : token.$value);
    case 'font':
      return transformFont(mode ? ((token.$extensions as any).mode[mode] as typeof token.$value) : token.$value);
    case 'cubicBezier':
      return transformCubicBezier(mode ? ((token.$extensions as any).mode[mode] as typeof token.$value) : token.$value);
    case 'link':
      return transformLink(mode ? ((token.$extensions as any).mode[mode] as typeof token.$value) : token.$value);
    case 'strokeStyle':
      return transformStrokeStyle(mode ? ((token.$extensions as any).mode[mode] as typeof token.$value) : token.$value);
    case 'border':
      return transformBorder(mode ? {...token.$value, ...((token.$extensions as any).mode[mode] as typeof token.$value)} : token.$value);
    case 'shadow':
      return transformShadow(mode ? {...token.$value, ...((token.$extensions as any).mode[mode] as typeof token.$value)} : token.$value);
    case 'gradient':
      return transformGradient(mode ? {...token.$value, ...((token.$extensions as any).mode[mode] as typeof token.$value)} : token.$value);
    case 'transition':
      return transformTransition(mode ? {...token.$value, ...((token.$extensions as any).mode[mode] as typeof token.$value)} : token.$value);
    case 'typography':
      return transformTypography(mode ? {...token.$value, ...((token.$extensions as any).mode[mode] as typeof token.$value)} : token.$value);
    default:
      throw new Error(`No transformer defined for $type: ${(token as any).$type} tokens`);
  }
}

/** parse modeSelector */
function parseModeSelector(modeID: string): [string, string] {
  if (!modeID.includes('#')) throw new Error(`modeSelector key must have "#" character`);
  const parts = modeID.split('#').map((s) => s.trim());
  if (parts.length > 2) throw new Error(`modeSelector key must have only 1 "#" character`);
  return [parts[0], parts[1]];
}
