import type { MetadataRoute } from "next";
import { SITE_URL } from "@/lib/site";
import { guideSource, referenceLoader } from "@/lib/source";

export const dynamic = "force-static";

/** Every page, with the trailing slash the export is served with. */
export default function sitemap(): MetadataRoute.Sitemap {
  const paths = ["/", ...guideSource.getPages().map((page) => page.url), ...referenceLoader.getPages().map((page) => page.url)];
  return paths.map((path) => ({ url: `${SITE_URL}${path.endsWith("/") ? path : `${path}/`}` }));
}
