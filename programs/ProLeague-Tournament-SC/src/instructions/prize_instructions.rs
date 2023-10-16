use anchor_spl::{
    associated_token::AssociatedToken,
    token::{Mint, Token, TokenAccount, Transfer},
};

use crate::{constant::TOURNAMENT_TAG, errors::TournamentError};

use {crate::constant::*, crate::state::*, anchor_lang::prelude::*};

#[derive(Accounts)]
pub struct ClaimPrize<'info> {
    #[account(mut)]
    pub tournament: Account<'info, Tournament>,
    #[account(mut)]
    pub winner: Signer<'info>,

    #[account(mut,
        constraint = tournament_token_account.mint == mint.key() && tournament_token_account.owner == tournament.key(),
    )]
    pub tournament_token_account: Account<'info, TokenAccount>,

    #[account(
        init_if_needed,
        payer = winner,
        associated_token::mint = mint,
        associated_token::authority = tournament,
        constraint = winner_token_account.mint == mint.key() && winner_token_account.owner == winner.key(),
    )]
    pub winner_token_account: Account<'info, TokenAccount>,

    #[account(mut, constraint = mint.key().eq(&CURRENCY_MINT))]
    pub mint: Account<'info, Mint>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug)]
pub struct ClaimPrizeArgs {
    pub round_index: u8,
}

pub fn claim_prize(ctx: Context<ClaimPrize>, args: ClaimPrizeArgs) -> Result<()> {
    let tournament_token_account = &mut ctx.accounts.tournament_token_account;
    let winner_token_account = &mut ctx.accounts.winner_token_account;
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
    } else {
        return Err(TournamentError::WinnerNotFound.into());
    }

    msg!("Assetions passed, transfering rewards.");

    let staker_seeds = &[
        TOURNAMENT_TAG.as_ref(),
        &tournament.tournament_id.to_le_bytes()[..],
        &[tournament.bump],
    ];
    let cpi_signer = &[&staker_seeds[..]];
    // Transfer the escrow balance from the creator to the new account (vault)
    let cpi_ctx = CpiContext::new_with_signer(
        ctx.accounts.token_program.to_account_info().clone(),
        Transfer {
            from: tournament_token_account.to_account_info(),
            to: winner_token_account.to_account_info(),
            authority: tournament.to_account_info(),
        },
        cpi_signer,
    );
    anchor_spl::token::transfer(cpi_ctx, round.winning_price)?;
    msg!("Prize claimed successfully.");

    Ok(())
}
