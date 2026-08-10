export interface EncryptedValue {
  version: 1;
  value: string;
}

function encode(bytes: Uint8Array): string {
  let raw = "";
  for (const byte of bytes) raw += String.fromCharCode(byte);
  return btoa(raw);
}

function decode(value: string): Uint8Array {
  return Uint8Array.from(atob(value), (character) => character.charCodeAt(0));
}

async function importKey(raw: Uint8Array): Promise<CryptoKey> {
  if (raw.length !== 32) throw new Error("APPDMIN_SECRET_KEY must decode to exactly 32 bytes");
  return await crypto.subtle.importKey("raw", raw as BufferSource, "AES-GCM", false, [
    "encrypt",
    "decrypt",
  ]);
}

export async function encryptValue(plaintext: string, rawKey: Uint8Array): Promise<EncryptedValue> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: "AES-GCM", iv },
      await importKey(rawKey),
      new TextEncoder().encode(plaintext),
    ),
  );
  const joined = new Uint8Array(iv.length + encrypted.length);
  joined.set(iv);
  joined.set(encrypted, iv.length);
  return { version: 1, value: encode(joined) };
}

export async function decryptValue(encrypted: EncryptedValue, rawKey: Uint8Array): Promise<string> {
  if (encrypted.version !== 1) throw new Error("unsupported encrypted value version");
  const joined = decode(encrypted.value);
  if (joined.length < 29) throw new Error("encrypted value is malformed");
  const plaintext = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: joined.slice(0, 12) },
    await importKey(rawKey),
    joined.slice(12),
  );
  return new TextDecoder().decode(plaintext);
}

const SECRET_KEY = /(secret|token|password|private.?key|api.?key|authorization|credential)/i;

export function redactSecrets(value: unknown, knownValues: string[] = []): unknown {
  const secrets = knownValues.filter((item) => item.length >= 4);
  function walk(item: unknown, key = ""): unknown {
    if (SECRET_KEY.test(key) && typeof item === "string") return "••••••••";
    if (typeof item === "string") {
      let result = item;
      for (const secret of secrets) result = result.replaceAll(secret, "••••••••");
      return result;
    }
    if (Array.isArray(item)) return item.map((child) => walk(child));
    if (item && typeof item === "object") {
      return Object.fromEntries(
        Object.entries(item).map(([childKey, child]) => [childKey, walk(child, childKey)]),
      );
    }
    return item;
  }
  return walk(value);
}
