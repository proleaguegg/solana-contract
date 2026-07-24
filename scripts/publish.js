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

// Always publish to the real npm registry. `yarn run publish` injects
// npm_config_registry=https://registry.yarnpkg.com (a read-only mirror), which
// makes `npm publish` 404 on PUT — so we pin the registry explicitly here.
const REGISTRY = "https://registry.npmjs.org/";

// Write a registry-SCOPED auth line into dist/.npmrc. A bare `_authToken=` is
// ignored by npm ("must be scoped to a registry"); it has to be keyed by the
// registry host. dist/ is gitignored, so the token never lands in the repo.
const npmrcPath = path.join(__dirname, "..", "dist", ".npmrc");
fs.writeFileSync(
  npmrcPath,
  `//registry.npmjs.org/:_authToken=${token}\nregistry=${REGISTRY}\n`
);

// No try/catch: a failed publish MUST fail the job. A green run should mean the
// package actually went out.
execSync(`npm publish --access public --registry ${REGISTRY}`, {
  cwd: path.join(__dirname, "..", "dist"),
  stdio: "inherit",
});

console.log("Published to npm successfully.");
