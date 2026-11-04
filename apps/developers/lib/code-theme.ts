import { createCssVariablesTheme } from "shiki/core";

/**
 * Code is coloured with the palette of the page, not with an editor theme: ink for the code, one blue for strings and links, greys for
 * the rest. The colours themselves live in global.css (`--uf-code-*`), so the light and dark pages share one theme.
 */
const theme = createCssVariablesTheme({ name: "unitfield", variablePrefix: "--uf-code-", variableDefaults: {}, fontStyle: true });

export const unitfieldCodeThemes = { light: theme, dark: theme } as const;
