import path from "path";
import fs from "fs";
import * as k from "@metaplex-foundation/kinobi";

const idlModifier = (idl) => {
  idl.types = idl.types.map((account) => {
    account.type.fields = account.type.fields.map((field) => {
      if (field.type.defined?.includes("HashMap")) {
        field.type = {
          hashMap: [
            "publicKey",
            { defined: field.type.defined.split(",")[1].slice(0, -1) },
          ],
        };
      }

      return field;
    });

    return account;
  });
  return idl;
};

// Paths.
const clientDir = path.join(__dirname, "clients");
const idlDir = path.join(__dirname, "./target/idl");
const idlPath = path.join(idlDir, "tournament.json");

const idl = idlModifier(require(idlPath));
idl.metadata = {
  origin: "anchor",
  address: "FLx2dcA4c4ZYhamknXRTgWYPg8NCr4Bt8Ut8oiUKcG5T",
};
// Instanciate Kinobi.
const kinobi = k.createFromIdls(idl);

// Update Accounts.
kinobi.update(
  new k.UpdateAccountsVisitor({
    tournament: {
      size: null,
      seeds: [
        k.stringConstantSeed("TOURNAMENT_STATE"),
        k.variableSeed(
          "tournament_id",
          k.numberTypeNode("u64", "le"),
          "Random Tournament id"
        ),
      ],
    },
  })
);

kinobi.update(
  new k.SetInstructionAccountDefaultValuesVisitor([
    {
      account: "tournament",
      ignoreIfOptional: true,
      ...k.pdaDefault("tournament"),
    },
  ])
);
//   {
//   initialize: {
//     accounts: {
//       tournament: {
//         defaultsTo: k.resolverDefault("tournament", [
//           k.dependsOnArg("tournament_id"),
//         ]),
//       },
//     },
//   },
// }
// Render JavaScript.
const jsDir = path.join(clientDir, "js", "src", "generated");
const prettier = require(path.join(clientDir, "js", ".prettierrc.json"));

kinobi.accept(
  new k.RenderJavaScriptVisitor(jsDir, {
    prettierOptions: prettier,
    formatCode: true,
    dependencyMap: {
      mplTokenMetadata: "@metaplex-foundation/mpl-token-metadata",
    },
  })
);

// // Render Rust.
// const crateDir = path.join(clientDir, "rust");
// const rustDir = path.join(clientDir, "rust", "src", "generated");
// kinobi.accept(
//   new k.RenderRustVisitor(rustDir, {
//     formatCode: true,
//     crateFolder: crateDir,
//   })
// );
