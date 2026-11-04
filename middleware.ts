import { NextResponse, type NextRequest } from "next/server";

const USER_COOKIE_NAME = "workbench_user_id";
const USER_HEADER_NAME = "x-user-id";

/**
 * O middleware apenas gera um ID quando não há cookie — ele NÃO autentica.
 * A validação da assinatura HMAC acontece em `getCurrentUserId()` (server).
 * Aqui só repassamos o valor do cookie para o header interno.
 */
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
  // Valor não-assinado só serve como rascunho — getCurrentUserId() em produção
  // rejeita cookies sem assinatura válida, então este header é ignorado lá.
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
