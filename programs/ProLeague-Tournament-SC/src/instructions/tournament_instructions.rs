use std::collections::HashMap;

use anchor_spl::{
    associated_token::AssociatedToken,
    token::{Mint, Token, TokenAccount, Transfer},
};

use {
    crate::{constant::*, errors::TournamentError, state::*},
    anchor_lang::prelude::*,
};

#[derive(Accounts)]
#[instruction(data: ArgumentInitialize)]
pub struct Initialize<'info> {
    #[account(mut)]
    pub creator: Signer<'info>,
    #[account(
        init,
        seeds = [TOURNAMENT_TAG.as_ref(), data.tournament_id.as_ref()],
        bump,
        payer = creator,
        space = Tournament::calculate_size(data.total_players, data.round_prizes.len()),
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
    pub joining_fees: u64,
    pub total_players: u16,
    pub tournament_concluded: bool,
    pub round_prizes: Vec<u64>, // Array of integers representing prizes for each round
    pub tournament_id: String,
}
pub fn initialize(ctx: Context<Initialize>, data: ArgumentInitialize) -> Result<()> {
    msg!("Tournament Initialized with data: {:?}!", data);
    let tournament = &mut ctx.accounts.tournament;
    let creator = &mut ctx.accounts.creator;
    let creator_token_account = &mut ctx.accounts.creator_token_account;
    let tournament_token_account = &mut ctx.accounts.tournament_token_account;
    tournament.set_defaults();

    // Update tournament details
    tournament.bump = ctx.bumps.tournament;
    tournament.creator = creator.key();
    tournament.tournament_id = data.tournament_id;
    tournament.joining_fees = data.joining_fees;
    tournament.total_players = data.total_players;
    tournament.tournament_concluded = false;

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
        anchor_spl::token::transfer(cpi_ctx, total_prize_sum - total_fee)?;
    }

    // msg!("Changed data to: {:?}!", data);

    Ok(())
}

#[derive(Accounts)]
pub struct ConcludeTournament<'info> {
    #[account(mut)]
    pub tournament: Account<'info, Tournament>,

    #[account(constraint = driver.key().eq(&DRIVER))]
    pub driver: Signer<'info>,
}

pub fn conclude_tournament(ctx: Context<ConcludeTournament>) -> Result<()> {
    let tournament = &mut ctx.accounts.tournament;

    // Mark the match as concluded.
    tournament.tournament_concluded = true;

    msg!("Match has been marked as concluded.");

    Ok(())
}

#[derive(Accounts)]
pub struct JoinTournament<'info> {
    #[account(mut, constraint = driver.key().eq(&DRIVER))]
    pub driver: Signer<'info>,

    /// CHECK: We are checking it in the body
    #[account(mut,constraint = player.key().eq(&player_info.key()) )]
    pub player: Option<Signer<'info>>,

    /// CHECK: We are checking it in the body
    #[account(mut)]
    pub player_info: AccountInfo<'info>,

    #[account(
        init_if_needed,
        payer = driver,
        associated_token::mint = mint,
        associated_token::authority = player,
    )]
    pub player_token_account: Option<Account<'info, TokenAccount>>,

    #[account(mut)]
    pub tournament: Account<'info, Tournament>,

    #[account(mut)]
    pub tournament_token_account: Account<'info, TokenAccount>,
    #[account(mut, constraint = mint.key().eq(&CURRENCY_MINT))]
    pub mint: Account<'info, Mint>,

    pub associated_token_program: Program<'info, AssociatedToken>,
    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

pub fn join_tournament(ctx: Context<JoinTournament>) -> Result<()> {
    let tournament = &mut ctx.accounts.tournament;
    let player = &ctx.accounts.player_info;
    let tournament_token_account = &ctx.accounts.tournament_token_account;

    // Check if the tournament is already concluded
    if tournament.tournament_concluded {
        return Err(TournamentError::TournamentNotConcluded.into());
    }

    // Check if the player has already joined
    if tournament.players.contains(&player.key()) {
        return Err(TournamentError::PlayerAlreadyJoined.into());
    }

    // Only transfer the joining fee if it is greater than zero
    if tournament.joining_fees > 0 {
        let player_token_account = ctx.accounts.player_token_account.as_ref().unwrap();
        // Ensure that the player is a signer if joining fees are required
        require!(player.is_signer, TournamentError::PlayerMustBeSigner);

        let cpi_ctx = CpiContext::new(
            ctx.accounts.token_program.to_account_info().clone(),
            Transfer {
                from: player_token_account.to_account_info(),
                to: tournament_token_account.to_account_info().clone(),
                authority: player.to_account_info().clone(),
            },
        );
        anchor_spl::token::transfer(cpi_ctx, tournament.joining_fees)?;
    }
    // Add the player to the tournament's list of players
    tournament.players.push(player.key());

    msg!("Player {:?} has joined the tournament!", player.key());

    Ok(())
}
