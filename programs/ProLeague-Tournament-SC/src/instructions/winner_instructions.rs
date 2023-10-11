use crate::errors::TournamentError;

use {crate::state::*, anchor_lang::prelude::*};

#[derive(Accounts)]
pub struct AddWinnerToRound<'info> {
    #[account(mut)]
    pub tournament: Account<'info, Tournament>,
    pub authority: Signer<'info>,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug)]
pub struct AddWinnerToRoundArgs {
    winner: Pubkey,
    round_index: u8,
}

pub fn add_winner(ctx: Context<AddWinnerToRound>, args: AddWinnerToRoundArgs) -> Result<()> {
    let tournament = &mut ctx.accounts.tournament;
    let winner = args.winner;
    let round_index = args.round_index;

    // Ensure the round exists.
    if round_index as usize >= tournament.rounds.len() {
        return Err(TournamentError::InvalidRound.into());
    }

    let round = &mut tournament.rounds[round_index as usize];

    // Ensure the winner doesn't already exist.
    if round.winner_exists(&winner) {
        return Err(TournamentError::WinnerAlreadyExists.into());
    }

    // Ensure the round hasn't reached its winner limit.
    if !round.can_add_winner() {
        return Err(TournamentError::RoundWinnerLimitReached.into());
    }

    // Add the winner with their initial status.
    round.winners_and_collected_status.insert(
        winner,
        RoundWinners {
            won_next_round: false,
            claimed: false,
        },
    );

    Ok(())
}
