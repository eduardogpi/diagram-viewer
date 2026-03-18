import { createDecipheriv, createCipheriv, randomBytes, createHash } from "crypto";

const SECRET = process.env.SECRET_ENCRYPTION_KEY;

if (!SECRET) {
  console.warn("SECRET_ENCRYPTION_KEY is not set. Sensitive data cannot be encrypted.");
}

const key = SECRET
  ? createHash("sha256").update(SECRET).digest()
  : Buffer.alloc(32, 0); // fallback to zeroed key for dev warnings

export function encryptSecret(plainText: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([cipher.update(plainText, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return `${iv.toString("hex")}:${encrypted.toString("hex")}:${authTag.toString("hex")}`;
}

export function decryptSecret(payload: string) {
  const [ivHex, contentHex, authTagHex] = payload.split(":");
  if (!ivHex || !contentHex || !authTagHex) {
    throw new Error("Invalid secret payload");
  }
  const iv = Buffer.from(ivHex, "hex");
  const encryptedText = Buffer.from(contentHex, "hex");
  const authTag = Buffer.from(authTagHex, "hex");
  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(authTag);
  const decrypted = Buffer.concat([decipher.update(encryptedText), decipher.final()]);
  return decrypted.toString("utf8");
}
