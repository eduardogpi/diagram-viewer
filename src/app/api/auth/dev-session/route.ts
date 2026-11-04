import { NextRequest, NextResponse } from "next/server";

import { USER_COOKIE_NAME, signSessionCookie } from "@/lib/auth/session";

export async function POST(req: NextRequest) {
  if (process.env.NODE_ENV === "production") {
    return NextResponse.json({ error: "Endpoint disponível apenas em desenvolvimento" }, { status: 404 });
  }

  const body = await req.json().catch(() => ({}));
  const rawUserId = typeof body?.userId === "string" ? body.userId : "";
  const userId = rawUserId.trim();

  if (!userId) {
    return NextResponse.json({ error: "Informe um identificador de usuário" }, { status: 400 });
  }

  const { value, maxAge } = signSessionCookie(userId);
  const response = NextResponse.json({ ok: true, userId });
  response.cookies.set(USER_COOKIE_NAME, value, {
    httpOnly: true,
    sameSite: "lax",
    secure: (process.env.NODE_ENV as string) === "production",
    path: "/",
    maxAge,
  });

  return response;
}

export async function DELETE() {
  if (process.env.NODE_ENV === "production") {
    return NextResponse.json({ error: "Endpoint disponível apenas em desenvolvimento" }, { status: 404 });
  }

  const response = NextResponse.json({ ok: true });
  response.cookies.set(USER_COOKIE_NAME, "", {
    httpOnly: true,
    sameSite: "lax",
    secure: (process.env.NODE_ENV as string) === "production",
    path: "/",
    maxAge: 0,
  });

  return response;
}
