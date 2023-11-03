use std::collections::HashMap;

use anchor_spl::{
    associated_token::AssociatedToken,
    token::{Mint, Token, TokenAccount, Transfer},
};

use {
    crate::{constant::*, state::*},
    anchor_lang::prelude::*,
};

#[derive(Accounts)]
#[instruction(data: ArgumentInitialize)]
pub struct Initialize<'info> {
    #[account(mut)]
    pub creator: Signer<'info>,
    #[account(
        init,
        seeds = [TOURNAMENT_TAG.as_ref(), data.tournament_id.to_le_bytes().as_ref()],
        bump,
        payer = creator,
        space = Tournament::LEN,
    )]
    pub tournament: Account<'info, Tournament>,

    #[account(init,
        payer = creator,
        associated_token::mint = mint,
        associated_token::authority = tournament,
    )]
    pub tournament_token_account: Account<'info, TokenAccount>,

    #[account(mut,
       constraint = creator_token_account.mint == mint.key() && creator_token_account.owner == creator.key(),
    )]
    pub creator_token_account: Account<'info, TokenAccount>,
    #[account(mut, constraint = mint.key().eq(&CURRENCY_MINT))]
    pub mint: Account<'info, Mint>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug)]
pub struct ArgumentInitialize {
    pub creator: Pubkey,
    pub tournament_id: u64,
    pub joining_fees: u64,
    pub total_players: u16,
    pub match_concluded: bool,
    pub round_prizes: Vec<u64>, // Array of integers representing prizes for each round
}
pub fn initialize(ctx: Context<Initialize>, data: ArgumentInitialize) -> Result<()> {
    let tournament = &mut ctx.accounts.tournament;
    let creator = &mut ctx.accounts.creator;
    let creator_token_account = &mut ctx.accounts.creator_token_account;
    let tournament_token_account = &mut ctx.accounts.tournament_token_account;
    tournament.set_defaults();

    // Update tournament details
    tournament.bump = ctx.bumps.tournament;
    tournament.creator = data.creator;
    tournament.tournament_id = data.tournament_id;
    tournament.joining_fees = data.joining_fees;
    tournament.total_players = data.total_players;
    tournament.match_concluded = false;

    tournament.total_rounds = (tournament.total_players as f32).log2() as u16;

    // Check the escrow_balance and  round_prizes sum
    let mut total_prize_sum: u64 = 0;
    let total_fee: u64 = tournament.joining_fees * (tournament.total_players as u64);

    // This will give: 1, 1, 2, 4, 8, ... for each round
    let mut winners_in_current_round = 1;

    for i in 0..data.round_prizes.len() {
        total_prize_sum += data.round_prizes[i] * winners_in_current_round;

        // Double the winners for every round after the first two rounds
        if i >= 1 {
            winners_in_current_round *= 2;
        }
    }

    // Initialize rounds based on total players
    let num_rounds = (data.total_players as f64).log2().ceil() as usize;
    tournament.rounds = Vec::with_capacity(num_rounds as usize);
    for i in 0..num_rounds {
        tournament.rounds.push(Round {
            reverse_index: i as u8,
            winning_price: data.round_prizes[i as usize], // Or any default value you want
            winners_and_collected_status: HashMap::new(),
        });
    }

    msg!("Tournament Initialized with data: {:?}!", data);
    if total_fee < total_prize_sum {
        // Transfer the escrow balance from the creator to the new account (vault)
        let cpi_ctx = CpiContext::new(
            ctx.accounts.token_program.to_account_info().clone(),
            Transfer {
                from: creator_token_account.to_account_info().clone(),
                to: tournament_token_account.to_account_info().clone(),
                authority: creator.to_account_info().clone(),
            },
        );
        anchor_spl::token::transfer(cpi_ctx,  total_prize_sum - total_fee)?;
    }

    msg!("Changed data to: {:?}!", data);

    Ok(())
}

#[derive(Accounts)]
pub struct ConcludeMatch<'info> {
    #[account(mut)]
    pub tournament: Account<'info, Tournament>,
    pub creator: Signer<'info>, // Assuming the creator (like an admin or match referee) is required to conclude the match.
}

pub fn conclude_match(ctx: Context<ConcludeMatch>) -> Result<()> {
    let tournament = &mut ctx.accounts.tournament;

    // Mark the match as concluded.
    tournament.match_concluded = true;

    msg!("Match has been marked as concluded.");

    Ok(())
}
