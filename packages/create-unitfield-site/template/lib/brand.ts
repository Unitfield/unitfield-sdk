const HEX = /^#[0-9a-f]{6}$/i;
const FALLBACK = "#2f5d50";

/** The operator's brand color, only when it is a plain `#rrggbb` value (it ends up in a style attribute). */
export function brandColor(value: string | null | undefined): string {
  return value && HEX.test(value) ? value : FALLBACK;
}

function channel(hex: string, offset: number): number {
  const value = parseInt(hex.slice(offset, offset + 2), 16) / 255;
  return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
}

/** WCAG relative luminance of a `#rrggbb` color. */
function luminance(hex: string): number {
  return 0.2126 * channel(hex, 1) + 0.7152 * channel(hex, 3) + 0.0722 * channel(hex, 5);
}

/** White or near-black, whichever has more contrast against `background`, for text on a brand-colored button. */
export function readableOn(background: string): string {
  const light = 1.05 / (luminance(background) + 0.05);
  const dark = (luminance(background) + 0.05) / (luminance("#14201c") + 0.05);
  return light >= dark ? "#ffffff" : "#14201c";
}
