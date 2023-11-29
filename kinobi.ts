import path from "path";
import fs from "fs";
import * as k from "@metaplex-foundation/kinobi";
import { ASSOCIATED_TOKEN_PROGRAM_ID } from "@solana/spl-token";

const idlModifier = (idl) => {
  idl.types = idl.types.map((account) => {
    account.type.fields = account.type.fields.map((field) => {
      if (field.type.defined?.includes("HashMap")) {
        let [key, val] = field.type.defined.split(",");
        val = val.slice(0, -1);
        key = key.slice(key.indexOf("<") + 1);
        field.type = {
          hashMap: [key, { defined: val }],
        };
      }

      return field;
    });

    return account;
  });
  return idl;
};

// Paths.
const clientDir = path.join(__dirname);
const idlDir = path.join(__dirname, "./target/idl");
const idlPath = path.join(idlDir, "tournament.json");

const idl = idlModifier(require(idlPath));
idl.metadata = {
  origin: "anchor",
  address: "DRxkk1zSd1my8RP1HkD3D9gK43ReSHnCBcPjMg6mG7tR",
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
          k.stringTypeNode({
            size: {
              kind: "remainder",
            },
          }),
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
    {
      account: "tournamentTokenAccount",
      ignoreIfOptional: true,
      ...k.pdaDefault("associatedToken", {
        importFrom: "mplToolbox",
        seeds: {
          mint: k.accountDefault("mint"),
          owner: k.accountDefault("tournament"),
        },
      }),
    },
    {
      account: "playerTokenAccount",
      ignoreIfOptional: true,
      ...k.pdaDefault("associatedToken", {
        importFrom: "mplToolbox",
        seeds: {
          mint: k.accountDefault("mint"),
          owner: k.accountDefault("player"),
        },
      }),
    },
    {
      account: "creatorTokenAccount",
      ignoreIfOptional: true,
      ...k.pdaDefault("associatedToken", {
        importFrom: "mplToolbox",
        seeds: {
          mint: k.accountDefault("mint"),
          owner: k.accountDefault("creator"),
        },
      }),
    },
    {
      account: "winnerTokenAccount",
      ignoreIfOptional: true,
      ...k.pdaDefault("associatedToken", {
        importFrom: "mplToolbox",
        seeds: {
          mint: k.accountDefault("mint"),
          owner: k.accountDefault("winner"),
        },
      }),
    },
    {
      account: "associatedTokenProgram",
      ignoreIfOptional: true,
      ...k.programDefault(
        "associatedTokenProgram",
        ASSOCIATED_TOKEN_PROGRAM_ID.toString()
      ),
    },
    {
      account: "mint",
      ignoreIfOptional: true,
      ...k.publicKeyDefault("2jYyeN8DfzWvJaHZNUGYwP77Qavt2eJVYbUX9f3VW1CQ"),
    },
  ])
);
// {
// initialize: {
//   accounts: {
//     tournament: {
//       defaultsTo: k.resolverDefault("tournament", [
//         k.dependsOnArg("tournament_id"),
//       ]),
//     },
//   },
//   },
// }
// Render JavaScript.
const jsDir = path.join(clientDir, "js", "generated");
// const prettier = require(path.join(clientDir, "js", ".prettierrc.json"));

kinobi.accept(
  new k.RenderJavaScriptVisitor(jsDir, {
    // prettierOptions: prettier,
    // formatCode: true,
    // dependencyMap: {
    //   mplTokenMetadata: "@metaplex-foundation/mpl-token-metadata",
    // },
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
