import { NextResponse, type NextRequest } from "next/server";

import { USER_COOKIE_NAME, USER_HEADER_NAME } from "@/lib/auth/session";

export function middleware(req: NextRequest) {
  const existingUserId = req.cookies.get(USER_COOKIE_NAME)?.value;
  if (existingUserId) {
    const requestHeaders = new Headers(req.headers);
    requestHeaders.set(USER_HEADER_NAME, existingUserId);
    return NextResponse.next({
      request: {
        headers: requestHeaders,
      },
    });
  }

  const generatedUserId = crypto.randomUUID();
  const requestHeaders = new Headers(req.headers);
  requestHeaders.set(USER_HEADER_NAME, generatedUserId);

  const res = NextResponse.next({
    request: {
      headers: requestHeaders,
    },
  });
  res.cookies.set(USER_COOKIE_NAME, generatedUserId, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
  });
  return res;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
