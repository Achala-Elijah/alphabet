import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

export async function proxy(request: NextRequest) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const pathname = request.nextUrl.pathname;

  if (!url || !key) return NextResponse.next();

  let response = NextResponse.next({ request });
  const supabase = createServerClient(url, key, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value, options }) => {
          request.cookies.set(name, value);
          response.cookies.set(name, value, options);
        });
      }
    }
  });
  const { data: { user } } = await supabase.auth.getUser();
  const customerSession = request.cookies.get("alphabet_session")?.value || request.cookies.get("betkiing_session")?.value;
  const isProtected = pathname === "/account" || pathname.startsWith("/sub-admin") || pathname.startsWith("/admin");
  const isLoginPage = pathname === "/login" || pathname === "/sub-admin/login" || pathname === "/admin/login";

  if (isProtected && !isLoginPage && !user && !(pathname === "/account" && customerSession)) {
    const loginPath = pathname.startsWith("/sub-admin") ? "/sub-admin/login" : pathname.startsWith("/admin") ? "/admin/login" : "/login";
    return NextResponse.redirect(new URL(loginPath, request.url));
  }

  if (user && (pathname.startsWith("/sub-admin") || pathname.startsWith("/admin")) && !isLoginPage) {
    const { data: profile } = await supabase.from("profiles").select("role").eq("id", user.id).single();
    const allowed = profile?.role === "admin" || profile?.role === "sub_admin";
    if (!allowed) return NextResponse.redirect(new URL("/", request.url));
    if (profile.role === "sub_admin" && pathname.startsWith("/sub-admin/matches")) {
      return NextResponse.redirect(new URL("/sub-admin", request.url));
    }
  }

  return response;
}

export const config = {
  matcher: ["/account/:path*", "/admin/:path*", "/sub-admin/:path*"]
};
