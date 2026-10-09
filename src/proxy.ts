import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

/**
 * Keeps the Supabase session fresh on signed-in pages. Server Components cannot write cookies, so the
 * token refresh happens here, before rendering. Authorization is not decided here: every page and action
 * checks the user itself, and the database's row-level security has the last word.
 */
export async function proxy(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll(cookiesToSet, headers) {
          for (const { name, value } of cookiesToSet) {
            request.cookies.set(name, value);
          }
          response = NextResponse.next({ request });
          for (const { name, value, options } of cookiesToSet) {
            response.cookies.set(name, value, options);
          }
          for (const [key, value] of Object.entries(headers)) {
            response.headers.set(key, value);
          }
        },
      },
    },
  );

  // Validates the access token and refreshes it when it is about to expire.
  await supabase.auth.getClaims();
  return response;
}

export const config = {
  matcher: ["/portal/:path*", "/admin/:path*", "/crew/:path*", "/login", "/auth/:path*"],
};
