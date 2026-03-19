import { cookies, headers } from "next/headers";

const USER_COOKIE_NAME = "workbench_user_id";
const USER_HEADER_NAME = "x-user-id";

export async function getCurrentUserId() {
  const headerStore = await headers();
  const headerUserId = headerStore.get(USER_HEADER_NAME)?.trim();
  if (headerUserId) {
    return headerUserId;
  }

  const cookieStore = await cookies();
  const cookieUserId = cookieStore.get(USER_COOKIE_NAME)?.value?.trim();
  if (cookieUserId) {
    return cookieUserId;
  }

  return null;
}

export async function requireCurrentUserId() {
  const userId = await getCurrentUserId();
  if (!userId) {
    throw new Error("UNAUTHENTICATED");
  }
  return userId;
}

export { USER_COOKIE_NAME, USER_HEADER_NAME };
