use std::collections::HashMap;

use anchor_lang::solana_program::program::invoke;
use anchor_lang::solana_program::system_instruction::transfer;
use anchor_spl::{
    associated_token::AssociatedToken,
    token::{Mint, Token, TokenAccount, Transfer, CloseAccount},
};

use {
    crate::{constant::*, errors::TournamentError, state::*},
    anchor_lang::prelude::*,
};

#[derive(Accounts)]
#[instruction(data: ArgumentInitialize)]
pub struct Initialize<'info> {
    #[account(mut, constraint = driver.key().eq(&DRIVER))]
    pub driver: Signer<'info>,

    /// CHECK: We are checking it in the body
    #[account(mut,constraint = creator.key().eq(&creator_info.key()) )]
    pub creator: Option<Signer<'info>>,

    /// CHECK: We are checking it in the body
    #[account(mut)]
    pub creator_info: AccountInfo<'info>,

    /// Public info account
    #[account(seeds = [GLOBAL_TAG.as_ref(), crate::id().as_ref()],bump)]
    pub global: Account<'info, Global>,
  
    #[account(
        init,
        seeds = [TOURNAMENT_TAG.as_ref(), data.tournament_id.as_ref()],
        bump,
        payer = driver,
        space = Tournament::calculate_size(data.total_players, (data.total_players as f32).log2() as u16),
    )]
    pub tournament: Account<'info, Tournament>,

    #[account(init,
        payer = driver,
        associated_token::mint = mint,
        associated_token::authority = tournament,
    )]
    pub tournament_token_account: Account<'info, TokenAccount>,
    #[account()]
    pub mint: Account<'info, Mint>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug)]
pub struct ArgumentInitialize {
    pub joining_fees: u64,
    pub total_players: u16,
    pub winning_rounds: u8,
    pub tournament_id: String,
}
pub fn initialize(ctx: Context<Initialize>, data: ArgumentInitialize) -> Result<()> {
    msg!("Tournament Initialized with data: {:?}!", data);
    let tournament = &mut ctx.accounts.tournament;
    let global = &mut ctx.accounts.global;
    let creator = &ctx.accounts.creator_info;
    let driver = &ctx.accounts.driver;
    let mint = &ctx.accounts.mint;
    tournament.set_defaults();

    if !global.whitelist_mint.contains(&mint.key()){
        require!(creator.is_signer, TournamentError::CreatorMustBeSigner);
        // Instruction handler to perform the SOL transfer
        let ix = transfer(
            &creator.key(),
            &driver.key(),
            NON_WHITELISTED_CREATION_FEE,
        );
        invoke(
            &ix,
            &[
                creator.to_account_info(),
                driver.to_account_info(),
                ctx.accounts.system_program.to_account_info(),
                ],
        )?;
    }
        
    tournament.mint = mint.key();
    // Update tournament details
    tournament.bump = ctx.bumps.tournament;
    tournament.creator = creator.key();
    tournament.tournament_id = data.tournament_id;
    tournament.joining_fees = data.joining_fees;
    tournament.total_players = data.total_players;
    // tournament.tournament_closed = false;
    tournament.is_published = false;
    // tournament.is_closed = false;
    // tournament.is_sponsored = false;

    tournament.total_rounds = (tournament.total_players as f32).log2() as u16;

    Ok(())
}

#[derive(Accounts)]
#[instruction(data: ArgumentPublishTournament)]
pub struct PublishTournament<'info> {
    #[account()]
    pub creator: Signer<'info>,

    #[account(mut)]
    pub tournament: Account<'info, Tournament>,

    #[account(mut,
        constraint = tournament_token_account.mint == mint.key() && tournament_token_account.owner == tournament.key(),
    )]
    pub tournament_token_account: Account<'info, TokenAccount>,

    #[account(mut,
       constraint = creator_token_account.mint == mint.key() && creator_token_account.owner == creator.key(),
    )]
    pub creator_token_account: Account<'info, TokenAccount>,
    #[account()]
    pub mint: Account<'info, Mint>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug)]
pub struct ArgumentPublishTournament {
    pub joining_fees: Option<u64>,
    pub round_prizes: Vec<u64>, // Array of integers representing prizes for each round
}
pub fn publish_tournament(
    ctx: Context<PublishTournament>,
    data: ArgumentPublishTournament,
) -> Result<()> {
    msg!("Pulbish Tournament with data: {:?}!", data);
    let tournament = &mut ctx.accounts.tournament;
    let creator = &ctx.accounts.creator;
    let creator_token_account = &mut ctx.accounts.creator_token_account;
    let tournament_token_account = &mut ctx.accounts.tournament_token_account;

    // // Validate if the match has been closed
    // if tournament.tournament_closed {
    //     return Err(TournamentError::TournamentIsClosed.into());
    // }

    // Update tournament details
    if let Some(joining_fees) = data.joining_fees {
        tournament.joining_fees = joining_fees;
    }
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
    let num_rounds = (tournament.total_players as f64).log2().ceil() as usize;
    tournament.rounds = Vec::with_capacity(num_rounds as usize);
    for i in 0..num_rounds {
        tournament.rounds.push(Round {
            reverse_index: i as u8,
            winning_price: data.round_prizes.get(i).clone().map(|x| x.to_owned()).unwrap_or(0u64), // Or any default value you want
            winners_and_collected_status: HashMap::new(),
        });
    }

    let needed_amount = if tournament_token_account.amount > total_prize_sum {
        0
    } else {
        total_prize_sum - tournament_token_account.amount
    };
    if total_fee < needed_amount {
        // Transfer the escrow balance from the creator to the new account (vault)
        let cpi_ctx = CpiContext::new(
            ctx.accounts.token_program.to_account_info().clone(),
            Transfer {
                from: creator_token_account.to_account_info().clone(),
                to: tournament_token_account.to_account_info().clone(),
                authority: creator.to_account_info().clone(),
            },
        );
        anchor_spl::token::transfer(cpi_ctx, needed_amount - total_fee)?;
    }
    tournament.is_published = true;
    // msg!("Changed data to: {:?}!", data);

    Ok(())
}

#[derive(Accounts)]
#[instruction(data: ArgumentSponsorTournament)]
pub struct SponsorTournament<'info> {
    #[account()]
    pub sponsor: Signer<'info>,

    #[account(mut)]
    pub tournament: Account<'info, Tournament>,

    #[account(mut,
        constraint = tournament_token_account.mint == mint.key() && tournament_token_account.owner == tournament.key(),
    )]
    pub tournament_token_account: Account<'info, TokenAccount>,

    #[account(mut,
       constraint = sponsor_token_account.mint == mint.key() && sponsor_token_account.owner == sponsor.key(),
    )]
    pub sponsor_token_account: Account<'info, TokenAccount>,
    #[account()]
    pub mint: Account<'info, Mint>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug)]
pub struct ArgumentSponsorTournament {
    pub sponsor_amount: u64,
}
pub fn sponsor_tournament(
    ctx: Context<SponsorTournament>,
    data: ArgumentSponsorTournament,
) -> Result<()> {
    msg!("Sponsor Tournament with data: {:?}!", data);
    let tournament = &mut ctx.accounts.tournament;
    let sponsor = &ctx.accounts.sponsor;
    let sponsor_token_account = &mut ctx.accounts.sponsor_token_account;
    let tournament_token_account = &mut ctx.accounts.tournament_token_account;
    let sponsor_amount = data.sponsor_amount;

    // // Validate if the match has been closed
    // if tournament.tournament_closed {
    //     return Err(TournamentError::TournamentIsClosed.into());
    // }

    // Validate if the tournament is already sponsored
    if tournament.sponsor_amount > 0 {
        return Err(TournamentError::TournamentAlreadySponsored.into());
    }

    // Transfer the escrow balance from the sponsor to the new account (vault)
    let cpi_ctx = CpiContext::new(
        ctx.accounts.token_program.to_account_info().clone(),
        Transfer {
            from: sponsor_token_account.to_account_info().clone(),
            to: tournament_token_account.to_account_info().clone(),
            authority: sponsor.to_account_info().clone(),
        },
    );

    anchor_spl::token::transfer(cpi_ctx, sponsor_amount)?;

    tournament.sponsor_amount = sponsor_amount;
    tournament.sponsor = sponsor.key();
    tournament.is_sponsored = true;

    // msg!("Changed data to: {:?}!", data);

    Ok(())
}

#[derive(Accounts)]
pub struct CloseTournament<'info> {
    #[account(mut, close = driver)]
    pub tournament: Account<'info, Tournament>,

    #[account(mut,
        constraint = tournament_token_account.mint == mint.key() && tournament_token_account.owner == tournament.key(),        
    )]
    pub tournament_token_account: Account<'info, TokenAccount>,


    #[account(mut,
        constraint = creator_token_account.mint == mint.key() && creator_token_account.owner == tournament.creator.key(),
     )]
     pub creator_token_account: Account<'info, TokenAccount>,


    #[account(constraint = driver.key().eq(&DRIVER))]
    pub driver: Signer<'info>,

    #[account()]
    pub mint: Account<'info, Mint>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

pub fn close_tournament(ctx: Context<CloseTournament>) -> Result<()> {
    let tournament = &mut ctx.accounts.tournament;
    let creator_token_account = &mut ctx.accounts.creator_token_account;
    let driver = &ctx.accounts.driver;
    let tournament_token_account = &mut ctx.accounts.tournament_token_account;
    
    // Loop through each round
    for round in tournament.rounds.iter() {
        // Check each winner's claimed status
        if round.winning_price > 0 {
            let expected_length = if round.reverse_index > 0 {
            2u32.pow((round.reverse_index)as u32) as usize
            } else {
            1
            };
            msg!("expected_length: {}",expected_length);
            msg!("winners_and_collected_status.len: {}",round.winners_and_collected_status.len());
            if expected_length != round.winners_and_collected_status.len() {
                return Err(TournamentError::ExpectedWinnerLength.into()); // Define YourError as needed
            }
            let mut claimed_count = 0;
            for winner_status in round.winners_and_collected_status.values() {
                if winner_status.claimed {
                    claimed_count += 1;
                }
            }
    
            let half_players = expected_length / 2; // calculate half (integer division)
    
            // If the number of claimed prizes is not exactly half, throw an error
            if claimed_count != half_players {
                return Err(TournamentError::PrizeNotClaimed.into()); // Define YourError as needed
            }
            // for winner_status in round.winners_and_collected_status.values() {
            //     // if !winner_status.claimed && !winner_status.won_next_round && round.winning_price > 0 { // risky but have to do it becuase of job ruing concurrently
            //     if !winner_status.claimed && round.winning_price > 0 {
            //         // If any winner has not claimed their prize, throw an error
            //         return Err(TournamentError::PrizeNotClaimed.into()); // Define YourError as needed
            //     }
            // }
        }
    }

    // Send remaining tokens to the specific address
    let remaining_balance = tournament_token_account.amount;
    let tournament_seed = &[
        TOURNAMENT_TAG.as_ref(),
        &tournament.tournament_id.as_ref(),
        &[tournament.bump],
    ];
    let cpi_signer = &[&tournament_seed[..]];

    if remaining_balance > 0 {
       
        // Transfer the escrow balance from the tournament to the creator (vault)
        let cpi_ctx = CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info().clone(),
            Transfer {
                from: tournament_token_account.to_account_info(),
                to: creator_token_account.to_account_info(),
                authority: tournament.to_account_info(),
            },
            cpi_signer
        );
        anchor_spl::token::transfer(cpi_ctx, remaining_balance)?;

    }
    // Close Tournament Token Account
    let cpi_ctx = CpiContext::new_with_signer(
        ctx.accounts.token_program.to_account_info().clone(),
        CloseAccount {
            account:tournament_token_account.to_account_info(),
            destination: driver.to_account_info(),
            authority: tournament.to_account_info(), 
        },
        cpi_signer
    );
    anchor_spl::token::close_account(cpi_ctx)?;

    msg!("Match has been marked as closed & closed.");

    Ok(())
}
