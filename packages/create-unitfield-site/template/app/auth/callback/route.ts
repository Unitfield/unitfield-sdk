import { NextResponse, type NextRequest } from "next/server";
import { siteUrl } from "@/lib/config";
import { customerAuth, signInEnabled, signInRequestCookie, tokenStore } from "@/lib/session";

function home(search = ""): NextResponse {
  const response = NextResponse.redirect(`${siteUrl()}/${search}`);
  response.headers.set("cache-control", "no-store");
  return response;
}

/**
 * The redirect URI. `handleCallback` checks `state`, `iss` and any OAuth error, redeems the code with the PKCE verifier
 * (no client secret: this is a public client) and validates the ID token, including its nonce.
 */
export async function GET(request: NextRequest) {
  if (!signInEnabled()) return new NextResponse("Sign-in is not configured.", { status: 404 });
  const params = request.nextUrl.searchParams;
  const state = params.get("state");
  // `take` removes the cookie, so a callback can be redeemed once.
  const saved = state ? await (await signInRequestCookie()).take(state) : null;
  if (!saved) return home("?sign-in=failed");
  try {
    const tokens = await customerAuth().handleCallback(params, saved);
    await (await tokenStore()).set(tokens);
    return home();
  } catch (error) {
    // The SDK's errors carry no secrets. Log the reason for you; the visitor only sees a generic message.
    console.error("Customer sign-in failed:", error instanceof Error ? `${error.name}: ${error.message}` : error);
    return home("?sign-in=failed");
  }
}
