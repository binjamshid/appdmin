const BASE = document.querySelector('meta[name="appdmin-base"]').content;
const view = document.querySelector("#view");
const title = document.querySelector("#page-title");
const eyebrow = document.querySelector("#page-eyebrow");
const dialog = document.querySelector("#dialog");
const dialogBody = document.querySelector("#dialog-body");
let me;
let snapshot;
let csrf = "";

const NAV = [
  ["overview", "Overview", "⌁", []],
  ["products", "Products", "◫", []],
  ["costs", "Costs", "◒", ["costs"]],
  ["people", "People", "♙", ["people"]],
  ["operations", "Operations", "⌘", ["infrastructure", "health"]],
  ["masoon", "Masoon", "◉", ["privacy_telemetry"]],
  ["actions", "Actions", "↗", ["actions"]],
  ["audit", "Audit", "◷", []],
  ["settings", "Settings", "⚙", []],
];

const escapeHtml = (value) =>
  String(value ?? "").replace(
    /[&<>"']/g,
    (character) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character],
  );
const formatNumber = (value) =>
  value === null || value === undefined
    ? "Not available"
    : new Intl.NumberFormat(undefined, { notation: "compact", maximumFractionDigits: 1 }).format(
      Number(value),
    );
const relative = (value) => {
  if (!value) return "Never";
  const seconds = Math.max(0, Math.round((Date.now() - new Date(value)) / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3600) return `${Math.round(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.round(seconds / 3600)}h ago`;
  return `${Math.round(seconds / 86400)}d ago`;
};

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

async function addPasskey() {
  const options = await api("/auth/passkeys/options", { method: "POST", body: "{}" });
  options.challenge = decodeBase64url(options.challenge);
  options.user.id = decodeBase64url(options.user.id);
  options.excludeCredentials = (options.excludeCredentials ?? []).map((credential) => ({
    ...credential,
    id: decodeBase64url(credential.id),
  }));
  const credential = await navigator.credentials.create({ publicKey: options });
  const nickname = navigator.userAgent.includes("Mobile") ? "Mobile passkey" : "Desktop passkey";
  await api("/auth/passkeys/verify", {
    method: "POST",
    body: JSON.stringify({
      nickname,
      response: {
        id: credential.id,
        rawId: encodeBase64url(credential.rawId),
        type: credential.type,
        authenticatorAttachment: credential.authenticatorAttachment,
        clientExtensionResults: credential.getClientExtensionResults(),
        response: {
          clientDataJSON: encodeBase64url(credential.response.clientDataJSON),
          attestationObject: encodeBase64url(credential.response.attestationObject),
          transports: credential.response.getTransports?.() ?? [],
        },
      },
    }),
  });
  me = await api("/auth/me");
  csrf = me.csrf_token;
  toast("Passkey added.");
}

async function api(path, options = {}) {
  const response = await fetch(`${BASE}/api${path}`, {
    ...options,
    headers: {
      "content-type": "application/json",
      ...(csrf ? { "x-appdmin-csrf": csrf } : {}),
      ...(options.headers ?? {}),
    },
  });
  if (response.status === 401) {
    location.href = `${BASE}/login`;
    throw new Error("Sign-in required.");
  }
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error ?? "The request could not be completed.");
  return body;
}

function toast(message, tone = "ok") {
  const item = document.createElement("div");
  item.className = `toast ${tone}`;
  item.textContent = message;
  document.querySelector("#toasts").append(item);
  setTimeout(() => item.remove(), 4500);
}

function capabilities() {
  return new Set(
    (snapshot?.adapters ?? []).filter((adapter) => adapter.enabled).flatMap((adapter) =>
      adapter.manifest?.capabilities ?? []
    ),
  );
}

function visibleNav() {
  const active = capabilities();
  return NAV.filter(([, , , required]) =>
    !required.length || required.some((item) => active.has(item))
  );
}

function renderNav(route) {
  const rows = visibleNav();
  document.querySelector("#desktop-nav").innerHTML = rows.map(([id, label, icon]) =>
    `<a href="#/${id}" class="nav-link ${
      route === id ? "active" : ""
    }"><span>${icon}</span>${label}</a>`
  ).join("");
  document.querySelector("#mobile-nav").innerHTML =
    rows.slice(0, 4).map(([id, label, icon]) =>
      `<a href="#/${id}" class="mobile-link ${
        route === id ? "active" : ""
      }"><span>${icon}</span><small>${label}</small></a>`
    ).join("") +
    `<a href="#/settings" class="mobile-link ${
      route === "settings" ? "active" : ""
    }"><span>•••</span><small>More</small></a>`;
}

function sourceBadge(observation) {
  const status = observation?.quality ?? "unavailable";
  return `<span class="quality ${escapeHtml(status)}"><i></i>${
    escapeHtml(status.replaceAll("_", " "))
  }</span>`;
}

function emptyState(titleText, copy, action = "") {
  return `<section class="empty-state"><div class="empty-symbol">⌁</div><h2>${
    escapeHtml(titleText)
  }</h2><p>${escapeHtml(copy)}</p>${action}</section>`;
}

function setPage(name, section = "Workspace") {
  title.textContent = name;
  eyebrow.textContent = section;
  view.setAttribute("aria-busy", "false");
}

function skeleton() {
  view.setAttribute("aria-busy", "true");
  view.innerHTML = `<div class="skeleton heading"></div><div class="metric-grid">${
    '<div class="skeleton card-skeleton"></div>'.repeat(4)
  }</div><div class="skeleton panel-skeleton"></div>`;
}

function renderOverview() {
  setPage("Overview");
  const products = snapshot.products ?? [];
  const adapters = snapshot.adapters ?? [];
  const observations = snapshot.observations ?? [];
  const healthy = adapters.filter((adapter) => adapter.health_status === "healthy").length;
  const failing = adapters.filter((adapter) => adapter.health_status === "failing").length;
  const pendingHealth =
    adapters.filter((adapter) =>
      adapter.enabled && ["degraded", "incompatible"].includes(adapter.health_status)
    ).length;
  const stale =
    observations.filter((item) => ["stale", "unavailable"].includes(item.quality)).length;
  const attention = [
    ...adapters.filter((adapter) =>
      adapter.enabled && ["failing", "degraded", "incompatible"].includes(adapter.health_status)
    ).map((adapter) => ({
      title: `${adapter.name} needs attention`,
      detail: adapter.health_message ?? "Run a connection test to verify this source.",
      tone: adapter.health_status === "failing" ? "critical" : "warning",
    })),
    ...observations.filter((item) => ["stale", "unavailable"].includes(item.quality)).slice(0, 5)
      .map((item) => ({
        title: `${item.metric} is ${item.quality}`,
        detail: `${item.source} · ${relative(item.collected_at)}`,
        tone: "warning",
      })),
  ];
  view.innerHTML = `
    <section class="hero-row"><div><h2>Good ${
    new Date().getHours() < 12 ? "morning" : new Date().getHours() < 18 ? "afternoon" : "evening"
  }.</h2><p>${
    attention.length
      ? `${attention.length} item${attention.length === 1 ? "" : "s"} deserve a closer look.`
      : products.length
      ? "Everything reporting is within its current state."
      : "Connect your first source to begin."
  }</p></div><button class="button" data-route="settings">Manage sources</button></section>
    <section class="metric-grid">
      <article class="metric-card"><span>Visible products</span><strong>${
    products.filter((product) => !product.hidden).length
  }</strong><small>${
    products.filter((product) => product.missingSince).length
  } missing at source</small></article>
      <article class="metric-card"><span>Active sources</span><strong>${
    adapters.filter((adapter) => adapter.enabled).length
  }</strong><small>${healthy} healthy</small></article>
      <article class="metric-card"><span>Current facts</span><strong>${observations.length}</strong><small>${stale} need context</small></article>
      <article class="metric-card"><span>Connection health</span><strong>${
    failing
      ? `${failing} failing`
      : pendingHealth
      ? `${pendingHealth} unverified`
      : adapters.length
      ? "Clear"
      : "No sources"
  }</strong><small>Never inferred</small></article>
    </section>
    <section class="panel"><header class="panel-head"><div><p class="eyebrow">Priority</p><h2>Needs attention</h2></div><span>${attention.length} open</span></header>
      ${
    attention.length
      ? `<div class="attention-list">${
        attention.map((item) =>
          `<article class="attention-row"><i class="${item.tone}"></i><div><strong>${
            escapeHtml(item.title)
          }</strong><p>${escapeHtml(item.detail)}</p></div></article>`
        ).join("")
      }</div>`
      : `<div class="all-clear"><i></i><div><strong>No active warnings</strong><p>Appdmin will keep source failures, stale facts, and permission problems visible here.</p></div></div>`
  }
    </section>
    <section class="panel"><header class="panel-head"><div><p class="eyebrow">Catalog</p><h2>Product pulse</h2></div><a href="#/products">View all</a></header>
      ${
    products.length
      ? `<div class="data-table"><div class="table-head"><span>Product</span><span>Platform</span><span>Source state</span><span>Last seen</span></div>${
        products.filter((product) => !product.hidden).slice(0, 8).map((product) =>
          `<div class="table-row"><span><strong>${escapeHtml(product.displayName)}</strong><small>${
            escapeHtml(product.kind)
          }</small></span><span>${escapeHtml(product.platform ?? "Not supplied")}</span><span>${
            product.missingSince
              ? sourceBadge({ quality: "stale" })
              : sourceBadge({ quality: "live" })
          }</span><span>${relative(product.lastSeenAt)}</span></div>`
        ).join("")
      }</div>`
      : emptyState(
        "No products yet",
        "Products appear only after an adapter discovers them. Add App Store Connect or another catalog source.",
        `<a class="button primary inline" href="#/settings">Add a source</a>`,
      )
  }
    </section>`;
}

function renderProducts() {
  setPage("Products", "Catalog");
  const products = snapshot.products ?? [];
  view.innerHTML =
    `<section class="page-intro"><div><h2>Source-owned catalog</h2><p>Rename, group, annotate, or hide discovered products without obscuring their source identity.</p></div><button class="button" id="discover-all">Discover now</button></section>
  ${
      products.length
        ? `<section class="panel flush"><div class="product-list">${
          products.map((product) =>
            `<article class="product-row ${
              product.hidden ? "dimmed" : ""
            }"><div class="product-icon">${
              escapeHtml(product.displayName.slice(0, 1).toUpperCase())
            }</div><div class="product-copy"><strong>${
              escapeHtml(product.displayName)
            }</strong><span>${escapeHtml(product.name)} · ${
              escapeHtml(product.platform ?? product.kind)
            }</span></div><div class="product-meta">${
              product.groupName ? `<span class="tag">${escapeHtml(product.groupName)}</span>` : ""
            }${
              product.missingSince
                ? sourceBadge({ quality: "stale" })
                : sourceBadge({ quality: "live" })
            }</div><button class="icon-button edit-product" data-id="${product.id}" aria-label="Edit ${
              escapeHtml(product.displayName)
            }">•••</button></article>`
          ).join("")
        }</div></section>`
        : emptyState(
          "Your catalog is empty",
          "Install a catalog-capable adapter and run discovery. Manual products are intentionally not supported.",
          `<a class="button primary inline" href="#/settings">Open integrations</a>`,
        )
    } `;
  document.querySelector("#discover-all")?.addEventListener("click", discoverAll);
  document.querySelectorAll(".edit-product").forEach((button) =>
    button.addEventListener("click", () => editProduct(button.dataset.id))
  );
}

function renderCosts() {
  setPage("Costs", "Finance");
  const observations = (snapshot.observations ?? []).filter((item) =>
    item.metric.includes("cost") || item.currency
  );
  const numeric = observations.filter((item) => typeof item.value === "number");
  const grouped = new Map();
  for (const item of numeric) {
    const currency = item.currency ?? "USD";
    grouped.set(currency, [...(grouped.get(currency) ?? []), item]);
  }
  view.innerHTML =
    `<section class="page-intro"><div><h2>Provider-authoritative spend</h2><p>Provider totals remain authoritative. Telemetry can attribute usage, never overwrite it.</p></div></section>
  <section class="metric-grid">${
      grouped.size
        ? [...grouped].map(([currency, items]) =>
          `<article class="metric-card"><span>Tracked spend</span><strong>${
            new Intl.NumberFormat(undefined, { style: "currency", currency }).format(
              items.reduce((sum, item) => sum + Number(item.value), 0),
            )
          }</strong><small>${items.length} provider fact${
            items.length === 1 ? "" : "s"
          }</small></article>`
        ).join("")
        : `<article class="metric-card"><span>Tracked spend</span><strong>Not available</strong><small>No authoritative total yet</small></article>`
    }</section>
  <section class="panel"><header class="panel-head"><div><p class="eyebrow">Sources</p><h2>Cost observations</h2></div></header>${
      observations.length
        ? `<div class="data-table"><div class="table-head four"><span>Metric</span><span>Value</span><span>Quality</span><span>Source</span></div>${
          observations.map((item) =>
            `<div class="table-row four"><span><strong>${escapeHtml(item.metric)}</strong><small>${
              escapeHtml(item.definition)
            }</small></span><span>${
              typeof item.value === "number" && item.currency
                ? `${escapeHtml(item.currency)} ${formatNumber(item.value)}`
                : formatNumber(item.value)
            }</span><span>${sourceBadge(item)}</span><span>${escapeHtml(item.source)}<small>${
              relative(item.collected_at)
            }</small></span></div>`
          ).join("")
        }</div>`
        : emptyState(
          "No cost facts",
          "Configure a provider with an account-usage credential, then collect. Appdmin will not estimate absent prices.",
        )
    }</section>`;
}

function renderOperations() {
  setPage("Operations", "Reliability");
  const adapters = snapshot.adapters ?? [];
  view.innerHTML =
    `<section class="page-intro"><div><h2>Every source, with provenance</h2><p>Connection health is separate from product health so failures cannot silently become zeros.</p></div><button class="button" id="test-all">Test connections</button></section>
  <section class="panel flush">${
      adapters.length
        ? `<div class="integration-list">${
          adapters.map((adapter) =>
            `<article class="integration-row"><div class="integration-logo">${
              escapeHtml(adapter.name.slice(0, 2).toUpperCase())
            }</div><div><strong>${escapeHtml(adapter.name)}</strong><p>${
              escapeHtml(
                adapter.health_message ?? `Last success ${relative(adapter.last_success_at)}`,
              )
            }</p></div>${
              sourceBadge({
                quality: adapter.health_status === "healthy"
                  ? "live"
                  : adapter.health_status === "disabled"
                  ? "no_source"
                  : "unavailable",
              })
            }<button class="button small test-adapter" data-id="${adapter.id}">Test</button></article>`
          ).join("")
        }</div>`
        : emptyState(
          "No operational sources",
          "Install an adapter to begin monitoring its upstream connection.",
        )
    }</section>`;
  document.querySelectorAll(".test-adapter").forEach((button) =>
    button.addEventListener("click", () => testAdapter(button.dataset.id, button))
  );
  document.querySelector("#test-all")?.addEventListener("click", async () => {
    for (const adapter of adapters.filter((item) => item.enabled)) await testAdapter(adapter.id);
  });
}

async function renderMasoonTelemetry() {
  setPage("Masoon", "Privacy-thresholded telemetry");
  const data = await api("/masoon-telemetry");
  const labels = {
    app_launch: "App launches",
    tab_opened: "Tab opens",
    mushaf_opened: "Mushaf opens",
    audio_download_succeeded: "Audio downloads succeeded",
    audio_download_failed: "Audio downloads failed",
    reference_download_succeeded: "Book downloads succeeded",
    reference_download_failed: "Book downloads failed",
    share_completed: "Shares completed",
  };
  const totals = new Map();
  for (const row of data.rows) totals.set(row.metric, (totals.get(row.metric) ?? 0) + row.count);
  view.innerHTML = `<section class="page-intro"><div><h2>Anonymous daily aggregates</h2><p>${
    escapeHtml(data.source)
  }. This surface cannot query users, devices, Quran coordinates, content, searches, reciters, books, or journeys.</p></div></section>
    <section class="metric-grid">${
    [...totals].slice(0, 4).map(([metric, count]) =>
      `<article class="metric-card"><span>${escapeHtml(labels[metric] ?? metric)}</span><strong>${
        formatNumber(count)
      }</strong><small>visible only after ${data.suppressionThreshold} events per day/build</small></article>`
    ).join("") ||
    `<article class="metric-card"><span>Visible aggregates</span><strong>None</strong><small>Low-volume slices are suppressed</small></article>`
  }</section>
    <section class="panel"><header class="panel-head"><div><p class="eyebrow">Privacy boundary</p><h2>Retention and provenance</h2></div></header>
      <div class="review-grid"><article><span>Suppression</span><strong>≥ ${data.suppressionThreshold}</strong><small>events per day/release/build/metric</small></article><article><span>Retry batches</span><strong>${data.rawRetentionDays} days</strong><small>identifier-free and not shown here</small></article><article><span>Daily totals</span><strong>${data.aggregateRetentionDays} days</strong><small>first-party only</small></article></div></section>
    <section class="panel"><header class="panel-head"><div><p class="eyebrow">Masoon first-party</p><h2>Thresholded release health</h2></div><span>${data.rows.length} visible slices</span></header>${
    data.rows.length
      ? `<div class="data-table"><div class="table-head four"><span>Day</span><span>Release</span><span>Metric</span><span>Count</span></div>${
        data.rows.map((row) =>
          `<div class="table-row four"><span>${escapeHtml(row.day)}</span><span>${
            escapeHtml(row.release)
          } (${escapeHtml(row.build)})</span><span>${
            escapeHtml(labels[row.metric] ?? row.metric)
          }</span><span>${formatNumber(row.count)}</span></div>`
        ).join("")
      }</div>`
      : emptyState(
        "No reportable slices",
        "Nothing has crossed the privacy threshold. Appdmin does not reveal the suppressed values.",
      )
  }</section>`;
}

function renderAudit() {
  setPage("Audit", "Security");
  view.innerHTML =
    `<section class="page-intro"><div><h2>Append-only activity</h2><p>Authentication, configuration, discovery, and external writes are recorded without secret values.</p></div></section><section class="panel" id="audit-panel"><div class="skeleton panel-skeleton"></div></section>`;
  api("/audit").then((rows) => {
    document.querySelector("#audit-panel").innerHTML = rows.length
      ? `<div class="timeline">${
        rows.map((row) =>
          `<article><i class="${row.outcome === "ok" ? "ok" : "critical"}"></i><div><strong>${
            escapeHtml(row.action)
          }</strong><p>${escapeHtml(row.target ?? "Workspace")} · ${
            escapeHtml(row.actor ?? "System")
          }</p></div><time>${relative(row.at)}</time></article>`
        ).join("")
      }</div>`
      : emptyState("No audit events", "Activity will appear here as you configure Appdmin.");
  });
}

async function renderSettings() {
  setPage("Settings", "Workspace");
  const data = await api("/adapters");
  const workspace = snapshot.workspace ?? {};
  view.innerHTML =
    `<div class="settings-layout"><nav class="settings-nav"><a href="#workspace" class="active">Workspace</a><a href="#integrations">Integrations</a><a href="#security">Security</a><a href="#system">System</a></nav><div class="settings-content">
  <section class="panel" id="workspace"><header class="panel-head"><div><p class="eyebrow">Identity</p><h2>Workspace</h2></div></header><form id="workspace-form" class="form-grid"><label>Workspace name<input name="name" value="${
      escapeHtml(workspace.name ?? "Appdmin")
    }" required></label><label>Compact name<input name="compactName" value="${
      escapeHtml(workspace.compact_name ?? "Appdmin")
    }" maxlength="20"></label><label>Timezone<input name="timezone" value="${
      escapeHtml(workspace.timezone ?? "UTC")
    }" required></label><label>Display currency<input name="currency" value="${
      escapeHtml(workspace.currency ?? "USD")
    }" maxlength="3" required></label><label>Accent<select name="accent"><option value="indigo">Indigo</option><option value="blue">Blue</option><option value="graphite">Graphite</option><option value="green">Green</option></select></label><div class="form-action"><button class="button primary" type="submit">Save workspace</button></div></form></section>
  <section class="panel" id="integrations"><header class="panel-head"><div><p class="eyebrow">Data sources</p><h2>Integrations</h2></div><span>${data.installed.length} installed</span></header><div class="integration-list">${
      data.installed.map((adapter) => integrationRow(adapter, true)).join("")
    }${
      data.bundled.filter((candidate) =>
        !data.installed.some((adapter) => adapter.adapter_id === candidate.manifest.id)
      ).map((candidate) => integrationRow(candidate, false)).join("")
    }</div></section>
  <section class="panel" id="security"><header class="panel-head"><div><p class="eyebrow">Owner</p><h2>Security</h2></div></header><div class="security-summary"><div><strong>Two-factor sign-in</strong><p>${
      me.factors.totp_enrolled ? "Authenticator enrolled" : "Authenticator setup required"
    } · ${me.factors.passkeys.length} passkey${
      me.factors.passkeys.length === 1 ? "" : "s"
    }</p></div><span class="quality live"><i></i>Required</span></div><button class="button" id="logout">Sign out</button></section>
  <section class="panel" id="system"><header class="panel-head"><div><p class="eyebrow">Runtime</p><h2>System</h2></div></header><div id="system-info" class="system-grid"><div class="skeleton card-skeleton"></div></div></section>
  </div></div>`;
  document.querySelector("#workspace-form").addEventListener("submit", saveWorkspaceForm);
  document.querySelectorAll(".install-adapter").forEach((button) =>
    button.addEventListener("click", () => openInstall(button.dataset.slug))
  );
  document.querySelectorAll(".configure-adapter").forEach((button) =>
    button.addEventListener("click", () => openConfigure(button.dataset.id))
  );
  document.querySelector("#logout").addEventListener("click", async () => {
    await api("/auth/logout", { method: "POST", body: "{}" });
    location.href = `${BASE}/login`;
  });
  api("/system").then((system) => {
    document.querySelector("#system-info").innerHTML = `<article><span>Appdmin</span><strong>${
      escapeHtml(system.version)
    }</strong></article><article><span>Deno</span><strong>${
      escapeHtml(system.runtime)
    }</strong></article><article><span>Database</span><strong>${
      system.database.ok ? `${system.database.latencyMs} ms` : "Unavailable"
    }</strong></article><article><span>Source & license</span><strong><a href="${
      escapeHtml(system.sourceUrl)
    }" target="_blank" rel="noreferrer">${escapeHtml(system.license)} ↗</a></strong></article>`;
  });
}

function integrationRow(item, installed) {
  const manifest = installed ? item.manifest : item.manifest;
  return `<article class="integration-row"><div class="integration-logo">${
    escapeHtml(manifest.name.slice(0, 2).toUpperCase())
  }</div><div><strong>${escapeHtml(manifest.name)}</strong><p>${
    escapeHtml(manifest.description ?? manifest.capabilities.join(", "))
  }</p></div>${
    installed
      ? sourceBadge({
        quality: item.enabled ? item.health_status === "healthy" ? "live" : "delayed" : "no_source",
      })
      : `<span class="tag">Bundled</span>`
  }<button class="button small ${installed ? "configure-adapter" : "install-adapter"}" ${
    installed ? `data-id="${item.id}"` : `data-slug="${item.slug}"`
  }>${installed ? "Configure" : "Add"}</button></article>`;
}

async function openInstall(slug) {
  const data = await api("/adapters");
  const candidate = data.bundled.find((item) => item.slug === slug);
  const permissions = candidate.manifest.permissions;
  const rows =
    Object.entries(permissions).flatMap(([key, values]) =>
      values.map((value) =>
        `<li><strong>${escapeHtml(key)}</strong><span>${escapeHtml(value)}</span></li>`
      )
    ).join("") || `<li><strong>None</strong><span>No external runtime permissions</span></li>`;
  dialogBody.innerHTML = `<p class="eyebrow">Install adapter</p><h2>${
    escapeHtml(candidate.manifest.name)
  }</h2><p>${
    escapeHtml(candidate.manifest.description)
  }</p><div class="permission-box"><strong>Requested permissions</strong><ul>${rows}</ul></div><label class="check-row"><input type="checkbox" id="accept-permissions"> I reviewed and accept this manifest.</label><button class="button primary" id="confirm-install">Install adapter</button>`;
  dialog.showModal();
  document.querySelector("#confirm-install").addEventListener("click", async () => {
    if (!document.querySelector("#accept-permissions").checked) {
      return toast("Review and accept the permissions first.", "warning");
    }
    await api(`/adapters/bundled/${slug}`, {
      method: "POST",
      body: JSON.stringify({ acceptPermissions: true }),
    });
    const wasOnboarding = document.querySelector("#app-shell").classList.contains(
      "onboarding-mode",
    );
    dialog.close();
    toast(`${candidate.manifest.name} installed.`);
    if (wasOnboarding) {
      location.reload();
      return;
    }
    await refresh(false);
    await renderSettings();
  });
}

async function openConfigure(id) {
  const data = await api("/adapters");
  const adapter = data.installed.find((item) => item.id === id);
  const properties = adapter.manifest.configSchema?.properties ?? {};
  dialogBody.innerHTML = `<p class="eyebrow">Integration</p><h2>${
    escapeHtml(adapter.name)
  }</h2><p>Saved secrets are never shown again. Leaving a field empty keeps its current value.</p><form id="adapter-config" class="form-stack">${
    Object.entries(properties).map(([key, schema]) =>
      `<label>${escapeHtml(schema.title ?? key)}<input name="${escapeHtml(key)}" ${
        schema.secret ? 'type="password" placeholder="Saved securely" autocomplete="off"' : ""
      }></label>`
    ).join("")
  }<div class="dialog-actions"><button class="button primary" type="submit">Save configuration</button><button class="button" type="button" id="test-config">Test connection</button></div></form>`;
  dialog.showModal();
  const form = document.querySelector("#adapter-config");
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const values = Object.fromEntries(
      [...new FormData(form)].filter(([, value]) => String(value).length),
    );
    await api(`/adapters/${id}/config`, { method: "PUT", body: JSON.stringify(values) });
    toast("Configuration saved.");
  });
  document.querySelector("#test-config").addEventListener("click", async (event) => {
    const values = Object.fromEntries(
      [...new FormData(form)].filter(([, value]) => String(value).length),
    );
    if (Object.keys(values).length) {
      await api(`/adapters/${id}/config`, { method: "PUT", body: JSON.stringify(values) });
    }
    await testAdapter(id, event.currentTarget);
  });
}

async function testAdapter(id, button) {
  if (button) {
    button.disabled = true;
    button.textContent = "Testing…";
  }
  try {
    await api(`/adapters/${id}/test`, { method: "POST", body: "{}" });
    toast("Connection succeeded.");
  } catch (error) {
    toast(error.message, "critical");
  } finally {
    if (button) {
      button.disabled = false;
      button.textContent = "Test";
    }
    await refresh(false);
  }
}

async function discoverAll() {
  const catalogAdapters = (snapshot.adapters ?? []).filter((adapter) =>
    adapter.enabled && adapter.manifest.capabilities.includes("catalog")
  );
  if (!catalogAdapters.length) return toast("Add a catalog-capable integration first.", "warning");
  for (const adapter of catalogAdapters) {
    try {
      await api(`/adapters/${adapter.id}/discover`, { method: "POST", body: "{}" });
    } catch (error) {
      toast(`${adapter.name}: ${error.message}`, "critical");
    }
  }
  await refresh(false);
  renderProducts();
  toast("Catalog discovery finished.");
}

function editProduct(id) {
  const product = snapshot.products.find((item) => item.id === id);
  dialogBody.innerHTML = `<p class="eyebrow">Catalog metadata</p><h2>${
    escapeHtml(product.displayName)
  }</h2><p>Source identity: ${escapeHtml(product.name)} · ${
    escapeHtml(product.externalId)
  }</p><form id="product-form" class="form-stack"><label>Display name<input name="displayName" value="${
    escapeHtml(product.displayName)
  }"></label><label>Group<input name="groupName" value="${
    escapeHtml(product.groupName ?? "")
  }"></label><label>Notes<textarea name="notes">${
    escapeHtml(product.notes ?? "")
  }</textarea></label><label class="check-row"><input name="hidden" type="checkbox" ${
    product.hidden ? "checked" : ""
  }> Hide from dashboard</label><button class="button primary" type="submit">Save product</button></form>`;
  dialog.showModal();
  document.querySelector("#product-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const data = Object.fromEntries(new FormData(event.currentTarget));
    data.hidden = event.currentTarget.elements.hidden.checked;
    await api(`/products/${id}`, { method: "PATCH", body: JSON.stringify(data) });
    dialog.close();
    await refresh(false);
    renderProducts();
    toast("Product updated.");
  });
}

async function saveWorkspaceForm(event) {
  event.preventDefault();
  const result = await api("/workspace", {
    method: "PUT",
    body: JSON.stringify(Object.fromEntries(new FormData(event.currentTarget))),
  });
  snapshot.workspace = result;
  document.querySelector("#brand-name").textContent = result.compact_name;
  toast("Workspace saved.");
}

async function renderOnboarding(state) {
  document.querySelector("#app-shell").classList.add("onboarding-mode");
  document.querySelector(".sidebar").hidden = true;
  document.querySelector(".mobile-nav").hidden = true;
  document.querySelector(".topbar").hidden = true;
  const steps = ["workspace", "security", "products", "providers", "review"];
  let active = steps.includes(state.current_step) ? state.current_step : "workspace";
  const render = async () => {
    const index = steps.indexOf(active);
    view.innerHTML =
      `<div class="onboarding"><aside class="progress-rail"><div class="brand"><span class="brand-mark">A</span><span><strong>Appdmin</strong><small>Workspace setup</small></span></div><ol>${
        steps.map((step, position) =>
          `<li class="${step === active ? "active" : ""} ${
            state.completed_steps.includes(step) ? "complete" : ""
          }"><i>${state.completed_steps.includes(step) ? "✓" : position + 1}</i><span><strong>${
            step[0].toUpperCase() + step.slice(1)
          }</strong><small>${
            [
              "Name and preferences",
              "Protect the owner",
              "Discover your catalog",
              "Connect inference",
              "Check and begin",
            ][position]
          }</small></span></li>`
        ).join("")
      }</ol></aside><section class="onboarding-main"><header class="mobile-progress"><span>Step ${
        index + 1
      } of 5</span><progress value="${
        index + 1
      }" max="5"></progress></header><div class="onboarding-copy" id="onboarding-copy"></div></section></div>`;
    const copy = document.querySelector("#onboarding-copy");
    if (active === "workspace") {
      copy.innerHTML =
        `<p class="eyebrow">Start with the essentials</p><h1>Make Appdmin yours.</h1><p class="lede">Choose how this private workspace identifies itself. These settings can change later.</p><form id="onboard-form" class="form-grid onboarding-form"><label>Workspace name<input name="name" value="${
          escapeHtml(snapshot.workspace?.name ?? "Appdmin")
        }" required></label><label>Compact name<input name="compactName" value="${
          escapeHtml(snapshot.workspace?.compact_name ?? "Appdmin")
        }" maxlength="20"></label><label>Timezone<input name="timezone" value="${
          escapeHtml(
            snapshot.workspace?.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone,
          )
        }"></label><label>Display currency<input name="currency" value="${
          escapeHtml(snapshot.workspace?.currency ?? "USD")
        }" maxlength="3"></label><input type="hidden" name="accent" value="indigo"><div class="onboarding-actions"><button class="button primary" type="submit">Save and continue</button></div></form>`;
    }
    if (active === "security") {
      copy.innerHTML =
        `<p class="eyebrow">Owner security</p><h1>Your account is protected.</h1><p class="lede">Appdmin requires a password and a second factor. Recovery material should be stored outside this server.</p><div class="review-grid"><article><span>Authenticator</span><strong>${
          me.factors.totp_enrolled ? "Enrolled" : "Required"
        }</strong>${
          sourceBadge({ quality: me.factors.totp_enrolled ? "live" : "unavailable" })
        }</article><article><span>Recovery codes</span><strong>${me.factors.recovery_codes_remaining}</strong><small>unused codes</small></article><article><span>Passkeys</span><strong>${me.factors.passkeys.length}</strong><small>optional, recommended</small></article></div><div class="security-offer"><div><strong>Prefer a passkey</strong><p>Use your device unlock for phishing-resistant sign-in.</p></div><button class="button" id="add-passkey">Add a passkey</button></div><div class="onboarding-actions"><button class="button primary" id="continue">Continue</button></div>`;
      copy.querySelector("#add-passkey")?.addEventListener("click", async (event) => {
        event.currentTarget.disabled = true;
        try {
          await addPasskey();
          event.currentTarget.textContent = "Passkey added";
        } catch (error) {
          toast(error.message ?? "Passkey setup was not completed.", "warning");
          event.currentTarget.disabled = false;
        }
      });
    }
    if (["products", "providers"].includes(active)) {
      const data = await api("/adapters");
      const wanted = active === "products"
        ? data.bundled.filter((item) => item.manifest.capabilities.includes("catalog"))
        : data.bundled.filter((item) =>
          item.manifest.capabilities.includes("costs") && item.slug !== "app-store-connect"
        );
      copy.innerHTML = `<p class="eyebrow">${
        active === "products" ? "Product sources" : "Inference accounting"
      }</p><h1>${
        active === "products" ? "Discover what you operate." : "Connect the providers you use."
      }</h1><p class="lede">${
        active === "products"
          ? "Products come from source systems, keeping identity and telemetry honest."
          : "Provider totals are authoritative. Missing accounting remains unavailable rather than estimated."
      }</p><div class="onboarding-integrations">${
        wanted.map((item) =>
          integrationRow(
            item,
            data.installed.some((adapter) => adapter.adapter_id === item.manifest.id),
          )
        ).join("")
      }</div><div class="onboarding-actions"><button class="button quiet" id="skip">Skip for now</button><button class="button primary" id="continue">Continue</button></div>`;
      copy.querySelectorAll(".install-adapter").forEach((button) =>
        button.addEventListener("click", () => openInstall(button.dataset.slug))
      );
      copy.querySelectorAll(".configure-adapter").forEach((button) =>
        button.addEventListener("click", () => openConfigure(button.dataset.id))
      );
    }
    if (active === "review") {
      copy.innerHTML =
        `<p class="eyebrow">Ready when you are</p><h1>Your workspace is ready.</h1><p class="lede">Nothing is fabricated. Empty areas will explain which source or permission is needed.</p><div class="review-grid"><article><span>Products</span><strong>${snapshot.products.length}</strong><small>source-discovered</small></article><article><span>Integrations</span><strong>${snapshot.adapters.length}</strong><small>${
          snapshot.adapters.filter((item) => item.enabled).length
        } enabled</small></article><article><span>Facts</span><strong>${snapshot.observations.length}</strong><small>with provenance</small></article></div><div class="onboarding-actions"><button class="button primary" id="finish">Open Appdmin</button></div>`;
    }
    copy.querySelector("#onboard-form")?.addEventListener("submit", async (event) => {
      event.preventDefault();
      await api("/workspace", {
        method: "PUT",
        body: JSON.stringify(Object.fromEntries(new FormData(event.currentTarget))),
      });
      await complete();
    });
    copy.querySelector("#continue")?.addEventListener("click", complete);
    copy.querySelector("#skip")?.addEventListener("click", complete);
    copy.querySelector("#finish")?.addEventListener("click", async () => {
      await api("/onboarding/review", { method: "PUT", body: JSON.stringify({ complete: true }) });
      location.reload();
    });
  };
  async function complete() {
    const index = steps.indexOf(active);
    await api(`/onboarding/${active}`, {
      method: "PUT",
      body: JSON.stringify({ complete: true }),
    });
    active = steps[Math.min(index + 1, steps.length - 1)];
    state = await api(`/onboarding/${active}`, {
      method: "PUT",
      body: JSON.stringify({ complete: false }),
    });
    await render();
  }
  await render();
}

async function route() {
  const id = location.hash.match(/^#\/([^/?]+)/)?.[1] ?? "overview";
  const allowed = new Set(visibleNav().map(([routeId]) => routeId));
  const target = allowed.has(id) ? id : "overview";
  renderNav(target);
  skeleton();
  ({
    overview: renderOverview,
    products: renderProducts,
    costs: renderCosts,
    operations: renderOperations,
    masoon: renderMasoonTelemetry,
    audit: renderAudit,
    settings: renderSettings,
    people: () => {
      setPage("People");
      view.innerHTML = emptyState(
        "No people capability",
        "Install an adapter that provides privacy-bounded people search.",
      );
    },
    actions: () => {
      setPage("Actions");
      view.innerHTML = emptyState(
        "No actions available",
        "Write-capable adapter actions appear here and always require step-up confirmation.",
      );
    },
  }[target] ?? renderOverview)();
}

async function refresh(render = true) {
  snapshot = await api("/overview");
  document.querySelector("#brand-name").textContent = snapshot.workspace?.compact_name ?? "Appdmin";
  document.querySelector("#sync-state").innerHTML = `<i></i>Updated now`;
  if (render) await route();
}

async function boot() {
  try {
    me = await api("/auth/me");
    csrf = me.csrf_token;
    document.querySelector("#owner-name").textContent = me.display_name;
    await refresh(false);
    const onboarding = await api("/onboarding");
    if (!onboarding.completed_at) return await renderOnboarding(onboarding);
    await route();
  } catch (error) {
    view.innerHTML = emptyState(
      "Appdmin could not load",
      error.message,
      `<button class="button" onclick="location.reload()">Try again</button>`,
    );
  }
}

window.addEventListener("hashchange", route);
document.querySelector("#refresh").addEventListener("click", () => refresh());
document.addEventListener("click", (event) => {
  const routeButton = event.target.closest("[data-route]");
  if (routeButton) location.hash = `#/${routeButton.dataset.route}`;
});
boot();
