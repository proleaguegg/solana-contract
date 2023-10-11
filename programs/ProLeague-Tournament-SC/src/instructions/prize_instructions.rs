use anchor_lang::system_program::Transfer;
use anchor_spl::token::{Token, self};

use crate::errors::TournamentError;

use {crate::state::*, anchor_lang::prelude::*};

#[derive(Accounts)]
pub struct ClaimPrize<'info> {
    #[account(mut)]
    pub tournament: Account<'info, Tournament>,
    #[account(mut)]
    pub vault: AccountInfo<'info>,
    pub authority: Signer<'info>,
    pub token_program: Program<'info, Token>, // Token program for the transfer instruction
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug)]
pub struct ClaimPrizeArgs {
    pub winner: Pubkey,
}

pub fn claim_prize(ctx: Context<ClaimPrize>, args: ClaimPrizeArgs) -> Result<()> {
    let tournament = &mut ctx.accounts.tournament;
    let round = &mut ctx.accounts.round; // Assuming you pass the specific round to claim from.
    let winner = args.winner;
    // Validate if the match has been concluded
    if !tournament.match_concluded {
        return Err(TournamentError::MatchNotConcluded.into());
    }

    // Check if winner exists in this round
    if let Some(winner_status) = round.winners_and_collected_status.get(&winner) {
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

        // Transfer the prize amount to the winner
        let cpi_accounts = Transfer {
            from: vault.to_account_info().clone(),
            to: ctx.accounts.authority.to_account_info().clone(), // Assuming `authority` is the winner's account.
            authority: ctx.accounts.authority.to_account_info().clone(),
        };
        let cpi_program = ctx.accounts.token_program.to_account_info().clone(); // Assuming you have token_program in context
        let cpi_ctx = CpiContext::new(cpi_program, cpi_accounts);
        token::transfer(cpi_ctx, round.winning_price)?;

        msg!("Prize claimed successfully.");
    } else {
        return Err(TournamentError::WinnerNotFound.into());
    }

    Ok(())
}
