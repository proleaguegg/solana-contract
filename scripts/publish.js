const { execSync } = require("child_process");

require("dotenv").config();

try {
  execSync(
    `echo _authToken=${process.env.NODE_AUTH_TOKEN} >> .npmrc && npm publish --access public`,
    {
      cwd: `dist`,
      stdio: "inherit",
    }
  );
} catch {
  console.log(`Error publishing, continuing...`);
}
