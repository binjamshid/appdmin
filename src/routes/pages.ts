import { Hono } from "hono";
import { config } from "../config.ts";

export const pages = new Hono();

function asset(name: string): string {
  return `${config.basePath === "/" ? "" : config.basePath}/static/${name}?v=2.0.4`;
}

function document(title: string, body: string, script: string): string {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta name="theme-color" content="#f4f5f8"><meta name="appdmin-base" content="${
    config.basePath === "/" ? "" : config.basePath
  }">
<title>${title}</title><link rel="icon" href="${asset("icon.svg")}"><link rel="manifest" href="${
    asset("manifest.webmanifest")
  }">
<link rel="stylesheet" href="${asset("app.css")}"></head><body>${body}<script type="module" src="${
    asset(script)
  }"></script></body></html>`;
}

pages.get("/login", (c) =>
  c.html(document(
    "Sign in · Appdmin",
    `
<main class="auth-shell"><section class="auth-card">
  <div class="brand-mark" aria-hidden="true">A</div><p class="eyebrow">Private operations</p><h1>Welcome to Appdmin</h1>
  <p class="lede">Sign in with your owner account. A second factor is always required.</p>
  <form id="password-form"><label>Username<input name="username" autocomplete="username" required></label>
  <label>Password<input name="password" type="password" autocomplete="current-password" required></label>
  <button class="button primary" type="submit">Continue</button></form>
  <form id="totp-form" hidden><button class="back-link" type="button" id="login-back">← Use another account</button>
  <label>Authenticator code<input name="code" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9]{6}" maxlength="6" required></label>
  <button class="button primary" type="submit">Sign in</button><button class="button quiet" id="show-recovery" type="button">Use a recovery code</button></form>
  <form id="recovery-form" hidden><button class="back-link" type="button" id="recovery-back">← Use authenticator</button>
  <label>Recovery code<input name="code" autocomplete="off" required></label><button class="button primary" type="submit">Sign in</button></form>
  <p class="form-error" id="login-error" role="alert"></p>
</section></main>`,
    "login.js",
  )));

pages.get("*", (c) =>
  c.html(document(
    "Appdmin",
    `
<div class="app-shell" id="app-shell">
  <aside class="sidebar">
    <a class="brand" href="#/overview"><span class="brand-mark">A</span><span><strong id="brand-name">Appdmin</strong><small>Operations</small></span></a>
    <nav id="desktop-nav" aria-label="Primary"></nav>
    <div class="sidebar-foot"><button class="owner-button" id="owner-menu"><span class="avatar">A</span><span><strong id="owner-name">Owner</strong><small>Workspace owner</small></span></button></div>
  </aside>
  <div class="content-frame"><header class="topbar"><div><p class="eyebrow" id="page-eyebrow">Workspace</p><h1 id="page-title">Overview</h1></div><div class="top-actions"><span class="sync-state" id="sync-state"><i></i>Connecting</span><button class="icon-button" id="refresh" aria-label="Refresh">↻</button></div></header>
  <div id="notice-region" aria-live="polite"></div><main id="view" tabindex="-1"></main></div>
  <nav class="mobile-nav" id="mobile-nav" aria-label="Primary"></nav>
</div>
<dialog id="dialog"><form method="dialog"><button class="dialog-close" aria-label="Close">×</button></form><div id="dialog-body"></div></dialog>
<div class="toast-region" id="toasts" aria-live="polite"></div>`,
    "app.js",
  )));
