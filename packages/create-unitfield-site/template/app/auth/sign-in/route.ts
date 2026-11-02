import { NextResponse, type NextRequest } from "next/server";
import { customerAuth, signInEnabled, signInRequestCookie } from "@/lib/session";

/**
 * Starts OIDC authorization code + PKCE. The PKCE verifier, the `state` and the `nonce` go into a short-lived sealed
 * httpOnly cookie; the browser is sent to the issuer with only the challenge.
 */
export async function GET(request: NextRequest) {
  if (!signInEnabled()) return new NextResponse("Sign-in is not configured.", { status: 404 });
  const loginHint = request.nextUrl.searchParams.get("email")?.trim().slice(0, 254);
  const authRequest = await customerAuth().createAuthorizationRequest(loginHint ? { loginHint } : {});
  await (await signInRequestCookie()).save(authRequest);
  const response = NextResponse.redirect(authRequest.url);
  response.headers.set("cache-control", "no-store");
  return response;
}
