const { execSync } = require("child_process");
const fs = require("fs");
const path = require("path");

require("dotenv").config();

// npm auth token (set as NODE_AUTH_TOKEN in CI from the NPM_AUTH_TOKEN secret)
const token = process.env.NODE_AUTH_TOKEN;
if (!token) {
  console.error("NODE_AUTH_TOKEN is not set — cannot publish.");
  process.exit(1);
}

// Always target the real npm registry. `yarn run publish` injects
// npm_config_registry=https://registry.yarnpkg.com (a read-only mirror), which
// makes `npm publish` 404 on PUT — so we pin the registry explicitly.
const REGISTRY = "https://registry.npmjs.org/";
const distDir = path.join(__dirname, "..", "dist");

const pkg = JSON.parse(
  fs.readFileSync(path.join(distDir, "package.json"), "utf8")
);
const spec = `${pkg.name}@${pkg.version}`;

// Idempotent: pushes to main happen on every change, but we only publish NEW
// versions. If this exact version already exists on npm, skip cleanly (success)
// instead of failing the job on a duplicate-version error.
let alreadyPublished = false;
try {
  execSync(`npm view ${spec} version --registry ${REGISTRY}`, {
    stdio: "pipe",
  });
  alreadyPublished = true;
} catch {
  alreadyPublished = false; // 404 -> not published yet
}

if (alreadyPublished) {
  console.log(`${spec} is already published — nothing to do.`);
  process.exit(0);
}

// Registry-SCOPED auth line. A bare `_authToken=` is ignored by npm
// ("must be scoped to a registry"). dist/ is gitignored, so the token never
// lands in the repo.
fs.writeFileSync(
  path.join(distDir, ".npmrc"),
  `//registry.npmjs.org/:_authToken=${token}\nregistry=${REGISTRY}\n`
);

// No try/catch: a real publish failure (auth, registry, validation) MUST fail
// the job so a green run genuinely means the package went out.
execSync(`npm publish --access public --registry ${REGISTRY}`, {
  cwd: distDir,
  stdio: "inherit",
});

console.log(`Published ${spec} to npm.`);
