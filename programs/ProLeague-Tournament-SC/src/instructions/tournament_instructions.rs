use std::collections::HashMap;

use anchor_lang::system_program::Transfer;

use crate::errors::TournamentError;

use {
    crate::{constant::*, state::*},
    anchor_lang::prelude::*,
};

#[derive(Accounts)]
#[instruction(data: ArgumentInitialize)]
pub struct Initialize<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,

    #[account(
        init,
        seeds = [TOURNAMENT_TAG.as_ref(), &data.tournament_id.to_le_bytes()[..]],
        bump,
        payer = authority,
        space = Tournament::LEN,
    )]
    pub tournament: Account<'info, Tournament>,

    pub system_program: Program<'info, System>,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug)]
pub struct ArgumentInitialize {
    pub creator: Pubkey,
    pub escrow_balance: u64,
    pub tournament_id: u64,
    pub joining_fees: u64,
    pub total_players: u32,
    pub total_rounds: u32,
    pub match_concluded: bool,
    pub round_prizes: Vec<u64>, // Array of integers representing prizes for each round
}
pub fn initialize(ctx: Context<Initialize>, data: ArgumentInitialize) -> Result<()> {
    let tournament = &mut ctx.accounts.tournament;
    tournament.set_defaults();

    // Update tournament details
    tournament.bump = ctx.bumps["tournament"];
    tournament.creator = data.creator;
    tournament.escrow_balance = data.escrow_balance;
    tournament.tournament_id = data.tournament_id;
    tournament.joining_fees = 0;
    tournament.total_players = data.total_players;
    tournament.match_concluded = false;

    tournament.total_rounds = data.total_rounds;

    // Check the escrow_balance and  round_prizes sum
    let mut total_prize_sum: u64 = 0;
    
    // This will give: 1, 1, 2, 4, 8, ... for each round
    let mut winners_in_current_round = 1; 

    for i in 0..data.round_prizes.len() {
        total_prize_sum += data.round_prizes[i] * winners_in_current_round;
        
        // Double the winners for every round after the first two rounds
        if i >= 1 {
            winners_in_current_round *= 2;
        }
    }

    if total_prize_sum > data.escrow_balance {
        return Err(TournamentError::ExceedingEscrowBalance.into());
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

    // Transfer the escrow balance from the creator to the new account (vault)
    let cpi_accounts = Transfer {
        from: ctx.accounts.authority.to_account_info().clone(),
        to: tournament.to_account_info().clone(),
    };
    let cpi_program = ctx.accounts.system_program.to_account_info().clone();
    let cpi_ctx = CpiContext::new(cpi_program, cpi_accounts);
    anchor_lang::system_program::transfer(cpi_ctx, data.escrow_balance)?;

    msg!("Changed data to: {:?}!", data);

    Ok(())
}

#[derive(Accounts)]
pub struct ConcludeMatch<'info> {
    #[account(mut)]
    pub tournament: Account<'info, Tournament>,
    pub authority: Signer<'info>, // Assuming the authority (like an admin or match referee) is required to conclude the match.
}

pub fn conclude_match(ctx: Context<ConcludeMatch>) -> Result<()> {
    let tournament = &mut ctx.accounts.tournament;

    // Mark the match as concluded.
    tournament.match_concluded = true;

    msg!("Match has been marked as concluded.");

    Ok(())
}
