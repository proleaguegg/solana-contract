import { UmiPlugin } from "@metaplex-foundation/umi";
import { mplToolbox } from "@metaplex-foundation/mpl-toolbox";
import { createTournamentProgram } from "../js";

export const tournamentProgram = (): UmiPlugin => ({
  install(umi) {
    umi.use(mplToolbox());
    umi.programs.add(createTournamentProgram(), false);
  },
});
