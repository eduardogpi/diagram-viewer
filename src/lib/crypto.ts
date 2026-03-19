import { createDecipheriv, createCipheriv, randomBytes, createHash } from "crypto";

const SECRET = process.env.SECRET_ENCRYPTION_KEY;

function getKey() {
  if (!SECRET) {
    throw new Error("SECRET_ENCRYPTION_KEY is not set");
  }

  return createHash("sha256").update(SECRET).digest();
}

export function encryptSecret(plainText: string) {
  const key = getKey();
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([cipher.update(plainText, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return `${iv.toString("hex")}:${encrypted.toString("hex")}:${authTag.toString("hex")}`;
}

export function decryptSecret(payload: string) {
  const key = getKey();
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
