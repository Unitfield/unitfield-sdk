import { NextResponse } from "next/server";
import { siteUrl } from "@/lib/config";
import { customerAuth, signInEnabled, tokenStore } from "@/lib/session";

/**
 * Revokes the refresh token at the issuer and clears the cookie. The browser is not sent to the issuer's end-session
 * URL: Unitfield's customer issuer accepts every login without remembering it, so it holds no session to end. (`signOut`
 * returns that `logoutUrl` if you want it; register your post-logout URL on the key first.)
 */
export async function POST() {
  if (signInEnabled()) {
    const store = await tokenStore();
    const tokens = await store.get();
    try {
      if (tokens) await customerAuth().signOut(tokens);
    } finally {
      await store.clear();
    }
  }
  // 303: the browser follows a POST with a GET of the home page.
  const response = NextResponse.redirect(`${siteUrl()}/`, 303);
  response.headers.set("cache-control", "no-store");
  return response;
}
