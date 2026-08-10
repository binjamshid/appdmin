import { sql } from "../db.ts";
import { encrypt, sha256Hex } from "../security/crypto.ts";
import { hashPassword, validatePasswordStrength } from "../security/password.ts";
import { generateSecret, otpauthUri, verifyTotp } from "../security/totp.ts";

export interface CreateAdminOptions {
  username?: string;
  displayName?: string;
  password?: string;
  totpCode?: string;
  nonInteractive?: boolean;
}

function recoveryCode(): string {
  const alphabet = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  const raw = Array.from(bytes, (byte) => alphabet[byte % alphabet.length]).join("");
  return raw.match(/.{4}/g)!.join("-");
}

export async function createAdmin(options: CreateAdminOptions): Promise<void> {
  const [{ count }] = await sql<
    { count: string }[]
  >`select count(*)::text as count from admin_accounts`;
  if (Number(count) > 0) {
    throw new Error("Appdmin already has an owner. Version one supports exactly one owner.");
  }
  const username = options.username?.trim() ||
    (!options.nonInteractive ? prompt("Username:")?.trim() : "");
  const displayName = options.displayName?.trim() ||
    (!options.nonInteractive ? prompt("Display name:")?.trim() : "");
  const password = options.password ||
    (!options.nonInteractive ? prompt("Password (14+ characters):") ?? "" : "");
  if (!username || !/^[A-Za-z0-9._-]{2,64}$/.test(username)) {
    throw new Error("Username must be 2 to 64 letters, numbers, dots, dashes, or underscores.");
  }
  if (!displayName) throw new Error("Display name is required.");
  const passwordError = validatePasswordStrength(password);
  if (passwordError) throw new Error(passwordError);

  const totpSecret = generateSecret();
  console.log("\nAdd this account to an authenticator before continuing:");
  console.log(otpauthUri(totpSecret, username, "Appdmin"));
  console.log(`Secret: ${totpSecret}\n`);
  const code = options.totpCode ||
    (!options.nonInteractive ? prompt("Current six-digit code:") ?? "" : "");
  const verified = await verifyTotp(totpSecret, code, null);
  if (!verified.valid) {
    throw new Error("The authenticator code did not verify. No owner was created.");
  }

  const [account] = await sql`
    insert into admin_accounts(username,display_name,password_hash,totp_secret_enc,totp_confirmed_at,totp_last_step)
    values (${username},${displayName},${await hashPassword(password)},${await encrypt(
    totpSecret,
  )},now(),${verified.step}) returning id
  `;
  const codes = Array.from({ length: 10 }, recoveryCode);
  for (const recovery of codes) {
    await sql`insert into recovery_codes(account_id,code_hash) values (${account.id},${await sha256Hex(
      recovery.replaceAll("-", ""),
    )})`;
  }
  console.log(
    "\nOwner created. Store these recovery codes offline; they will not be shown again:\n",
  );
  for (const recovery of codes) console.log(`  ${recovery}`);
}
