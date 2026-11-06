import { NextResponse } from "next/server";
import { isUnitfieldError, NotFoundError, type SmsDisclosure } from "@unitfield/sdk";
import { storefront } from "@/lib/storefront";

/**
 * Text-message opt-in for the inquiry form. The browser cannot call these API endpoints itself (CORS only covers the storefront API),
 * so the form talks to this route and the route talks to the API with the SDK. The organization is always your site's own: the route
 * reads it from the site, never from the request.
 */
export const dynamic = "force-dynamic";

const none = (status: number) => NextResponse.json({ code: status === 404 ? "not_found" : "invalid_request" }, { status, headers: { "Cache-Control": "no-store" } });

async function organization(): Promise<string> {
  return (await storefront().site.get()).brand.slug;
}

/** `GET /api/sms-consent`: the text to show next to the checkbox. A 404 means texting is not available: hide the checkbox. */
export async function GET() {
  try {
    const disclosure: SmsDisclosure = await storefront().smsConsent.disclosure(await organization());
    return NextResponse.json(disclosure, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return none(404);
  }
}

/** `POST /api/sms-consent` with `{ phone, disclosureVersion, email? }`: call it only for a ticked box, after the inquiry went through. */
export async function POST(request: Request) {
  const origin = request.headers.get("origin");
  if (origin && new URL(origin).host !== new URL(request.url).host) return none(403);
  const body: unknown = await request.json().catch(() => null);
  const input = body && typeof body === "object" ? (body as Record<string, unknown>) : null;
  if (typeof input?.phone !== "string" || typeof input.disclosureVersion !== "string") return none(400);
  try {
    const result = await storefront().smsConsent.record({
      org: await organization(),
      phone: input.phone,
      disclosureVersion: input.disclosureVersion,
      ...(typeof input.email === "string" ? { email: input.email } : {}),
    });
    return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof NotFoundError) return none(404);
    return NextResponse.json({ code: isUnitfieldError(error) ? "rejected" : "unavailable" }, { status: isUnitfieldError(error) ? 422 : 503, headers: { "Cache-Control": "no-store" } });
  }
}
