import { createWebhookVerifier, WebhookVerificationError, type WebhookVerifier } from "@unitfield/sdk/server";
import { revalidateTag } from "next/cache";
import { CACHE_TAG } from "@/lib/storefront";

// Receives Unitfield webhook deliveries and drops the cached API reads, so published changes show up at once instead of
// after the 60 second cache. It does nothing until UNITFIELD_WEBHOOK_SECRET is set.

let verifier: WebhookVerifier | undefined;
let verifierSecret: string | undefined;

function verifierFor(secret: string): WebhookVerifier {
  if (!verifier || verifierSecret !== secret) {
    // Several secrets, comma separated, are all accepted: that is how a secret is rotated without dropped deliveries.
    verifier = createWebhookVerifier({ secret: secret.split(",").map((part) => part.trim()).filter(Boolean) });
    verifierSecret = secret;
  }
  return verifier;
}

export async function POST(request: Request) {
  const secret = process.env.UNITFIELD_WEBHOOK_SECRET?.trim();
  if (!secret) return new Response("Webhooks are not configured.", { status: 503 });

  // The signature covers the exact bytes, so read the raw text before anything parses it.
  const body = await request.text();
  let event;
  try {
    ({ event } = await verifierFor(secret).constructEvent(body, request.headers));
  } catch (error) {
    if (error instanceof WebhookVerificationError) return new Response("Invalid webhook.", { status: 400 });
    throw error;
  }

  // `listing.*` and `site.*` change what the storefront API returns. Other events are acknowledged and ignored.
  if (event.type.startsWith("listing.") || event.type.startsWith("site.")) {
    // `{ expire: 0 }`: the next request fetches fresh data instead of being served the stale copy.
    revalidateTag(CACHE_TAG, { expire: 0 });
  }
  return Response.json({ received: true });
}
