const BASE = document.querySelector('meta[name="appdmin-base"]').content;
const error = document.querySelector("#login-error");
const passwordForm = document.querySelector("#password-form");
const totpForm = document.querySelector("#totp-form");
const recoveryForm = document.querySelector("#recovery-form");

function decodeBase64url(value) {
  const padded = value.replaceAll("-", "+").replaceAll("_", "/") +
    "=".repeat((4 - value.length % 4) % 4);
  return Uint8Array.from(atob(padded), (character) => character.charCodeAt(0));
}

function encodeBase64url(value) {
  let raw = "";
  for (const byte of new Uint8Array(value)) raw += String.fromCharCode(byte);
  return btoa(raw).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

async function signInWithPasskey() {
  const options = await request("/webauthn/options", {});
  options.challenge = decodeBase64url(options.challenge);
  options.allowCredentials = (options.allowCredentials ?? []).map((credential) => ({
    ...credential,
    id: decodeBase64url(credential.id),
  }));
  const credential = await navigator.credentials.get({ publicKey: options });
  return await request("/webauthn/verify", {
    id: credential.id,
    rawId: encodeBase64url(credential.rawId),
    type: credential.type,
    authenticatorAttachment: credential.authenticatorAttachment,
    clientExtensionResults: credential.getClientExtensionResults(),
    response: {
      clientDataJSON: encodeBase64url(credential.response.clientDataJSON),
      authenticatorData: encodeBase64url(credential.response.authenticatorData),
      signature: encodeBase64url(credential.response.signature),
      userHandle: credential.response.userHandle
        ? encodeBase64url(credential.response.userHandle)
        : null,
    },
  });
}

async function request(path, body) {
  const response = await fetch(`${BASE}/api/auth${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(
      {
        invalid_credentials: "The username or password is incorrect.",
        invalid_code: "That code is not valid. Check the time on your authenticator and try again.",
        code_already_used: "That code was already used. Wait for the next code.",
        rate_limited: "Too many attempts. Wait a moment before trying again.",
        no_second_factor: "This account needs a second factor before it can sign in.",
      }[result.error] ?? "Sign-in could not be completed.",
    );
  }
  return result;
}

function show(form) {
  for (const candidate of [passwordForm, totpForm, recoveryForm]) {
    candidate.hidden = candidate !== form;
  }
  error.textContent = "";
  form.querySelector("input")?.focus();
}

passwordForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  error.textContent = "";
  const button = passwordForm.querySelector("button");
  button.disabled = true;
  try {
    const data = Object.fromEntries(new FormData(passwordForm));
    const result = await request("/login", data);
    if (result.next === "webauthn") {
      try {
        await signInWithPasskey();
        location.href = `${BASE}/`;
        return;
      } catch (reason) {
        if (!result.methods?.totp) throw reason;
        show(totpForm);
        error.textContent =
          "The passkey was not completed. You can use your authenticator instead.";
      }
    } else show(totpForm);
  } catch (reason) {
    error.textContent = reason.message;
  } finally {
    button.disabled = false;
  }
});

totpForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const button = totpForm.querySelector("button[type=submit]");
  button.disabled = true;
  try {
    await request("/totp", Object.fromEntries(new FormData(totpForm)));
    location.href = `${BASE}/`;
  } catch (reason) {
    error.textContent = reason.message;
  } finally {
    button.disabled = false;
  }
});

recoveryForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const button = recoveryForm.querySelector("button[type=submit]");
  button.disabled = true;
  try {
    await request("/recovery", Object.fromEntries(new FormData(recoveryForm)));
    location.href = `${BASE}/`;
  } catch (reason) {
    error.textContent = reason.message;
  } finally {
    button.disabled = false;
  }
});

document.querySelector("#show-recovery").addEventListener("click", () => show(recoveryForm));
document.querySelector("#login-back").addEventListener("click", () => show(passwordForm));
document.querySelector("#recovery-back").addEventListener("click", () => show(totpForm));
