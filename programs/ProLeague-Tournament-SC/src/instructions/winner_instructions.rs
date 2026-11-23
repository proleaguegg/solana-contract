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
    // let tournament_immutable = ctx.accounts.tournament.clone();
    let tournament = &mut ctx.accounts.tournament;
    let winner = args.winner;
    let round_index = args.round_index;

    // M-04 / L-03: results only after the roster is locked and sized. Before
    // announce, players can still join or leave and the size check has not run.
    require!(
        tournament.is_announced,
        TournamentError::TournamentNotAnnounced
    );

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

    // msg!("ROUNDS: {:?}", tournament_immutable.rounds);

    // Add the winner with their initial status.
    round.winners_and_collected_status.insert(
        winner_index,
        RoundWinners {
            won_next_round: false,
            claimed: false,
        },
    );

    msg!("ROUNDS round_index: {:?}", round_index);
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
        .ok_or(TournamentError::PlayerNotFound)? as u32;
    // Ensure the round exists.
    if round_index as usize >= tournament.rounds.len() {
        return Err(TournamentError::InvalidRound.into());
    }

    // M-01: nobody advances out of the final, so the champion is always paid.
    require!(round_index != 0, TournamentError::CannotAdvanceFromFinal);

    let round = &mut tournament.rounds[round_index as usize];
    let advance_free = round.advanced_count() < round.funded_seats();

    // Ensure the winner exists for this round.
    if !round.winner_exists(&winner_index) {
        return Err(TournamentError::WinnerNotFound.into());
    }

    // Update the winner's status to indicate they've won the next round.
    // M-01: a paid winner cannot advance, and at most half the round advances.
    // Re-marking an advanced winner stays a no-op so retries succeed.
    if let Some(winner_status) = round.winners_and_collected_status.get_mut(&winner_index) {
        require!(!winner_status.claimed, TournamentError::AlreadyClaimed);
        if !winner_status.won_next_round {
            require!(advance_free, TournamentError::AdvanceLimitReached);
            winner_status.won_next_round = true;
        }
    }

    Ok(())
}

// Corrections for a wrong result. Neither can let one player be paid twice:
// a paid entry can't be removed, and a promotion can't be undone while the
// player is still recorded in the next round (where they may be paid).
// Fix order: remove_winner in the next round, unmark here, mark the right one.
pub fn unmark_winner_won_next_round(
    ctx: Context<MarkWinnerWonNextRound>,
    args: MarkWinnerWonNextRoundArgs,
) -> Result<()> {
    let tournament = &mut ctx.accounts.tournament;
    let round_index = args.round_index as usize;
    let winner_index = tournament
        .players
        .iter()
        .position(|address| address.eq(&args.winner))
        .ok_or(TournamentError::PlayerNotFound)? as u32;
    require!(
        round_index < tournament.rounds.len(),
        TournamentError::InvalidRound
    );
    require!(round_index != 0, TournamentError::CannotAdvanceFromFinal);
    require!(
        !tournament.rounds[round_index - 1].winner_exists(&winner_index),
        TournamentError::WinnerInNextRound
    );

    let status = tournament.rounds[round_index]
        .winners_and_collected_status
        .get_mut(&winner_index)
        .ok_or(TournamentError::WinnerNotFound)?;
    // Already unmarked stays a no-op so retries succeed.
    status.won_next_round = false;
    Ok(())
}

pub fn remove_winner(ctx: Context<AddWinnerToRound>, args: AddWinnerToRoundArgs) -> Result<()> {
    let tournament = &mut ctx.accounts.tournament;
    let round_index = args.round_index as usize;
    let winner_index = tournament
        .players
        .iter()
        .position(|address| address.eq(&args.winner))
        .ok_or(TournamentError::PlayerNotFound)? as u32;
    let round = tournament
        .rounds
        .get_mut(round_index)
        .ok_or(TournamentError::InvalidRound)?;

    // Already removed stays a no-op so retries succeed.
    if let Some(status) = round.winners_and_collected_status.get(&winner_index) {
        require!(!status.claimed, TournamentError::AlreadyClaimed);
        require!(!status.won_next_round, TournamentError::WinnerAdvanced);
        round.winners_and_collected_status.remove(&winner_index);
    }
    Ok(())
}
