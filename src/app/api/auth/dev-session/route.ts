import { NextRequest, NextResponse } from "next/server";

import { USER_COOKIE_NAME } from "@/lib/auth/session";

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

  const response = NextResponse.json({ ok: true, userId });
  response.cookies.set(USER_COOKIE_NAME, userId, {
    httpOnly: true,
    sameSite: "lax",
    secure: false,
    path: "/",
    maxAge: 60 * 60 * 24 * 30,
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
    secure: false,
    path: "/",
    maxAge: 0,
  });

  return response;
}
