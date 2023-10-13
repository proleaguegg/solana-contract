use anchor_lang::system_program::Transfer;
use anchor_spl::token::Token;

use crate::{constant::TOURNAMENT_TAG, errors::TournamentError};

use {crate::state::*, anchor_lang::prelude::*};

#[derive(Accounts)]
pub struct ClaimPrize<'info> {
    #[account(mut)]
    pub tournament: Account<'info, Tournament>,
    #[account(mut)]
    pub winner: Signer<'info>,
    pub token_program: Program<'info, Token>, // Token program for the transfer instruction
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug)]
pub struct ClaimPrizeArgs {
    pub round_index: u8,
}

pub fn claim_prize(ctx: Context<ClaimPrize>, args: ClaimPrizeArgs) -> Result<()> {
    let tournament = &mut ctx.accounts.tournament;
    let winner = ctx.accounts.winner.key();
    let round_index = args.round_index;
    
    // Validate if the match has been concluded
    if !tournament.match_concluded {
        return Err(TournamentError::MatchNotConcluded.into());
    }

    // Check if winner exists in this round
    let round = &mut tournament.clone().rounds[round_index as usize];
    if let Some(winner_status) = round.winners_and_collected_status.get_mut(&winner) {
        // Validate if the winner hasn't claimed already
        if winner_status.claimed {
            return Err(TournamentError::AlreadyClaimed.into());
        }

        // Validate if the winner hasn't won the next round
        if winner_status.won_next_round {
            return Err(TournamentError::WonNextRound.into());
        }

        // Mark as claimed
        winner_status.claimed = true;

        // TODO: Transfer the prize amount to the winner. This will need more context, like which account holds the funds, etc.

        msg!("Prize claimed successfully.");
    } else {
        return Err(TournamentError::WinnerNotFound.into());
    }

    // Transfer the prize amount to the winner
    let cpi_accounts = Transfer {
        from: tournament.to_account_info(),
        to: ctx.accounts.winner.to_account_info(), // Assuming `authority` is the winner's account.
                                                   // authority: ctx.accounts.authority.to_account_info().clone(),
    };
    let staker_seeds = &[
        TOURNAMENT_TAG.as_ref(),
        &tournament.tournament_id.to_le_bytes()[..],
        &[tournament.bump],
    ];
    let cpi_signer = &[&staker_seeds[..]];
    let cpi_program = ctx.accounts.token_program.to_account_info().clone(); // Assuming you have token_program in context
    let cpi_ctx = CpiContext::new_with_signer(cpi_program, cpi_accounts, cpi_signer);
    anchor_lang::system_program::transfer(cpi_ctx, round.winning_price)?;

    Ok(())
}
