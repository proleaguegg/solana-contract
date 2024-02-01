use crate::errors::TournamentError;

use {crate::constant::*, crate::state::*, anchor_lang::prelude::*};

#[derive(Accounts)]
pub struct AddWinnerToRound<'info> {
    #[account(mut)]
    pub tournament: Account<'info, Tournament>,

    #[account(constraint = driver.key().eq(&DRIVER))]
    pub driver: Signer<'info>,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug)]
pub struct AddWinnerToRoundArgs {
    winner: Pubkey,
    round_index: u8,
}

pub fn add_winner(ctx: Context<AddWinnerToRound>, args: AddWinnerToRoundArgs) -> Result<()> {
    let tournament_immutable = ctx.accounts.tournament.clone();
    let tournament = &mut ctx.accounts.tournament;
    let winner = args.winner;
    let round_index = args.round_index;

    let winner_index_option = tournament
        .players
        .iter()
        .position(|address| address.eq(&winner));

    let winner_index = match winner_index_option {
        Some(index) => index as u32,
        None => return Err(TournamentError::PlayerNotFound.into()),
    };

    // Ensure the round exists.
    if round_index as usize >= tournament.rounds.len() {
        return Err(TournamentError::InvalidRound.into());
    }

    let round = &mut tournament.rounds[round_index as usize];

    // Ensure the winner doesn't already exist.
    if round.winner_exists(&winner_index) {
        return Err(TournamentError::WinnerAlreadyExists.into());
    }

    // Ensure the round hasn't reached its winner limit.
    if !round.can_add_winner() {
        return Err(TournamentError::RoundWinnerLimitReached.into());
    }

    msg!("ROUNDS: {:?}", tournament_immutable.rounds);

    // Add the winner with their initial status.
    round.winners_and_collected_status.insert(
        winner_index,
        RoundWinners {
            won_next_round: false,
            claimed: false,
        },
    );

    msg!("ROUNDS: {:?}", tournament_immutable.rounds);
    Ok(())
}

#[derive(Accounts)]
pub struct MarkWinnerWonNextRound<'info> {
    #[account(mut)]
    pub tournament: Account<'info, Tournament>,

    #[account(constraint = driver.key().eq(&DRIVER))]
    pub driver: Signer<'info>,
}
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug)]
pub struct MarkWinnerWonNextRoundArgs {
    winner: Pubkey,
    round_index: u8,
}

pub fn mark_winner_won_next_round(
    ctx: Context<MarkWinnerWonNextRound>,
    args: MarkWinnerWonNextRoundArgs,
) -> Result<()> {
    let tournament = &mut ctx.accounts.tournament;
    let winner = args.winner;
    let round_index = args.round_index;
    let winner_index = tournament
        .players
        .iter()
        .position(|address| address.eq(&winner))
        .unwrap() as u32;
    // Ensure the round exists.
    if round_index as usize >= tournament.rounds.len() {
        return Err(TournamentError::InvalidRound.into());
    }

    let round = &mut tournament.rounds[round_index as usize];

    // Ensure the winner exists for this round.
    if !round.winner_exists(&winner_index) {
        return Err(TournamentError::WinnerNotFound.into());
    }

    // Update the winner's status to indicate they've won the next round.
    if let Some(winner_status) = round.winners_and_collected_status.get_mut(&winner_index) {
        winner_status.won_next_round = true;
    }

    Ok(())
}
