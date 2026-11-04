import { createOpenAPI } from "fumadocs-openapi/server";
import { getPublicApi } from "./public-api/load";
import { SURFACES } from "./public-api/surfaces";

/** The server side of the API reference: the public documents (snapshots, filtered and overlaid), one per API. */
export const openapi = createOpenAPI({
  input: Object.fromEntries(SURFACES.map((surface) => [surface.id, () => getPublicApi().documents[surface.id]!])),
});
