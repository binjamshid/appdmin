const ROOT = new URL("../", import.meta.url);
const IGNORED_DIRECTORIES = new Set([".git", ".superpowers", ".impeccable", ".appdmin"]);
const IGNORED_FILES = new Set(["deno.lock"]);
const TEXT_EXTENSIONS = new Set([
  ".ts",
  ".js",
  ".json",
  ".md",
  ".sql",
  ".yml",
  ".yaml",
  ".css",
  ".html",
  ".svg",
  ".service",
  ".tmpfiles",
  ".example",
  ".sh",
]);

const checks = [
  { name: "private key", expression: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/ },
  { name: "common API secret", expression: /\b(?:sk|rk|pk)_(?:live|prod)_[A-Za-z0-9_-]{12,}\b/ },
  { name: "cloud access key", expression: /\bAKIA[0-9A-Z]{16}\b/ },
  {
    name: "credential URL",
    expression: /postgres(?:ql)?:\/\/[^:\s/@]+:(?!change-me@|\$\{)[^@\s/]+@/,
  },
];

const extraTerms = (Deno.env.get("APPDMIN_PRIVATE_TERMS") ?? "")
  .split(",")
  .map((term) => term.trim().toLowerCase())
  .filter(Boolean);

const findings: string[] = [];

async function visit(directory: URL): Promise<void> {
  for await (const entry of Deno.readDir(directory)) {
    if (entry.isDirectory && IGNORED_DIRECTORIES.has(entry.name)) continue;
    if (IGNORED_FILES.has(entry.name)) continue;
    const url = new URL(entry.name + (entry.isDirectory ? "/" : ""), directory);
    if (entry.isDirectory) {
      await visit(url);
      continue;
    }
    const dot = entry.name.lastIndexOf(".");
    const extension = dot >= 0 ? entry.name.slice(dot) : "";
    if (!TEXT_EXTENSIONS.has(extension) && !entry.name.startsWith(".")) continue;
    const text = await Deno.readTextFile(url).catch(() => "");
    const relative = decodeURIComponent(url.pathname.slice(ROOT.pathname.length));
    for (const check of checks) {
      if (check.expression.test(text)) findings.push(`${relative}: possible ${check.name}`);
    }
    const lowercase = text.toLowerCase();
    for (const term of extraTerms) {
      if (lowercase.includes(term)) findings.push(`${relative}: contains configured private term`);
    }
  }
}

await visit(ROOT);
if (findings.length) {
  console.error(findings.join("\n"));
  Deno.exit(1);
}
console.log("Repository privacy scan passed.");
