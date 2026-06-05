import { createCipheriv, createDecipheriv, createHmac, createHash, randomBytes, timingSafeEqual } from "node:crypto";

const ENCRYPTION_ALGORITHM = "aes-256-gcm";

export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString("base64url");
}

export function hashToken(secret: string, token: string): string {
  return createHmac("sha256", secret).update(token).digest("base64url");
}

export function constantTimeEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);

  if (leftBuffer.length !== rightBuffer.length) {
    return false;
  }

  return timingSafeEqual(leftBuffer, rightBuffer);
}

export class TokenEncryption {
  private readonly key: Buffer;

  constructor(secret: string) {
    this.key = createHash("sha256").update(secret).digest();
  }

  encrypt(value: string | undefined): string | null {
    if (value === undefined || value === "") {
      return null;
    }

    const iv = randomBytes(12);
    const cipher = createCipheriv(ENCRYPTION_ALGORITHM, this.key, iv);
    const ciphertext = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
    const tag = cipher.getAuthTag();
    return ["v1", iv.toString("base64url"), tag.toString("base64url"), ciphertext.toString("base64url")].join(".");
  }

  decrypt(value: string | null | undefined): string | undefined {
    if (!value) {
      return undefined;
    }

    const [version, iv, tag, ciphertext] = value.split(".");
    if (version !== "v1" || !iv || !tag || !ciphertext) {
      throw new Error("Invalid encrypted token format.");
    }

    const decipher = createDecipheriv(ENCRYPTION_ALGORITHM, this.key, Buffer.from(iv, "base64url"));
    decipher.setAuthTag(Buffer.from(tag, "base64url"));
    const plaintext = Buffer.concat([
      decipher.update(Buffer.from(ciphertext, "base64url")),
      decipher.final()
    ]);
    return plaintext.toString("utf8");
  }
}
