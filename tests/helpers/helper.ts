import { Context, Pda } from "@metaplex-foundation/umi";
import fs from "fs";
import { setComputeUnitLimit } from "@metaplex-foundation/mpl-toolbox";
import { string } from "@metaplex-foundation/umi/serializers";
export function appendToJsonFile(filePath, newData) {
  fs.readFile(filePath, "utf8", (err, data) => {
    if (err) {
      if (err.code === "ENOENT") {
        // File does not exist, so create it with initial array containing newData
        console.log("File not found. Creating new file.");
        let initialData = [newData]; // Assuming we start with an array
        fs.writeFile(
          filePath,
          JSON.stringify(initialData, null, 4),
          "utf8",
          (err) => {
            if (err) {
              console.error("An error occurred while creating the file:", err);
            } else {
              console.log("File created and data added successfully.");
            }
          }
        );
      } else {
        console.error("An error occurred while reading the file:", err);
      }
      return;
    }

    try {
      // Parse the existing JSON data
      let jsonData = JSON.parse(data) || [];

      // Append new data to the JSON array
      // jsonData = [...jsonData, ...newData];
      jsonData = newData;

      // Convert the updated JSON object back to a string
      const updatedJsonData = JSON.stringify(jsonData, null, 4);

      // Write the updated JSON data back to the file
      fs.writeFile(filePath, updatedJsonData, "utf8", (err) => {
        if (err) {
          console.error("An error occurred while writing to the file:", err);
        } else {
          console.log("Data appended successfully.");
        }
      });
      return updatedJsonData;
    } catch (parseError) {
      console.error("An error occurred while parsing JSON data:", parseError);
    }
  });
}

// // Example usage
// const newString = "This is the new string to add.";
// appendToJsonFile("your_json_file.json", newString);

export const setComputeUnitsFunc = (umiInstance: Context, limit = 250000) =>
  setComputeUnitLimit(umiInstance, {
    units: limit,
  });

export function findTempTournamentPda(
  context: Pick<Context, "eddsa" | "programs">,
  seeds: {
    /** Random Tournament id */
    tournamentId: string;
  }
): Pda {
  const programId = context.programs.getPublicKey(
    "tournament",
    "matchNmUczmPKteQb9BJ8gRgafaQpDh2oDZJGuLsHfR"
  );
  return context.eddsa.findPda(programId, [
    string({ size: "variable" }).serialize("TEMP_TOURNAMENT"),
    string({ size: "variable" }).serialize("TOURNAMENT_STATE"),
    string({ size: "variable" }).serialize(seeds.tournamentId),
  ]);
}
