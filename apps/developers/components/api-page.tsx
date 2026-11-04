"use client";
import { createOpenAPIPage } from "fumadocs-openapi/ui";
import { unitfieldCodeThemes } from "@/lib/code-theme";

/**
 * The operation pages. The "Try it" playground is off: this is a static site, and a browser on developers.unitfield.com is not an
 * allowed origin of anybody's publishable key.
 */
export const OpenAPIPage = createOpenAPIPage({
  playground: { enabled: false },
  shikiOptions: { themes: unitfieldCodeThemes },
});
