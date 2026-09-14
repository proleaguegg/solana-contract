use std::collections::HashMap;

use anchor_lang::solana_program::program::invoke;
use anchor_lang::solana_program::system_instruction::transfer;
use anchor_spl::{
    associated_token::AssociatedToken,
    token::{Mint, Token, TokenAccount, Transfer, CloseAccount},
};

use {
    crate::{constant::*, errors::TournamentError, state::*, utils::compute_net_bps},
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
    pub platform_fee_bps: u16,
}
pub fn initialize(ctx: Context<Initialize>, data: ArgumentInitialize) -> Result<()> {
    msg!("Tournament Initialized with data: {:?}!", data);
    let tournament = &mut ctx.accounts.tournament;
    let global = &mut ctx.accounts.global;
    let creator = &ctx.accounts.creator_info;
    let driver = &ctx.accounts.driver;
    let mint = &ctx.accounts.mint;
    tournament.set_defaults();

    require!(
        data.platform_fee_bps <= PLATFORM_FEE_BPS_MAX,
        TournamentError::InvalidFee
    );

    // The bracket only works on a power of two: the account is sized with
    // log2() truncated while publish builds log2().ceil() rounds, so anything
    // else allocates too little space and wedges the tournament after entry
    // fees are already escrowed.
    require!(
        data.total_players >= 2 && data.total_players.is_power_of_two(),
        TournamentError::InvalidPlayerCount
    );

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
    tournament.platform_fee_bps = data.platform_fee_bps;
    tournament.pending_fees = 0;
    // tournament.tournament_closed = false;
    tournament.is_published = false;
    tournament.is_announced = false;
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

    #[account(mut, constraint = tournament.creator == creator.key() @ TournamentError::WrongCreator)]
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

    // Publish exactly once. Re-publishing would let the prize ladder and entry
    // fee be rewritten mid-tournament (wiping recorded winners along with it).
    require!(
        !tournament.is_published,
        TournamentError::TournamentPublished
    );

    // Update tournament details
    if let Some(joining_fees) = data.joining_fees {
        // The entry fee is what every booked platform fee is derived from, so
        // it can't move once anyone has paid it — refunds would no longer
        // match what was charged.
        require!(
            tournament.players.is_empty(),
            TournamentError::PlayerAlreadyJoined
        );
        tournament.joining_fees = joining_fees;
    }
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

    // Money already sitting in escrow net of platform fees already booked on it
    // (e.g. a sponsor deposit that landed before publish), plus what entry fees
    // will net out to once the platform's cut is skimmed off each join.
    let available_net_now = tournament_token_account
        .amount
        .checked_sub(tournament.pending_fees)
        .ok_or(TournamentError::OverFlow)?;
    let entry_net_per_player =
        compute_net_bps(tournament.joining_fees, tournament.platform_fee_bps, TOTAL_BPS)
            .ok_or(TournamentError::OverFlow)?;
    // Only the seats still open get projected — anyone who already joined has
    // their money sitting in the escrow above, and counting them twice would
    // understate the shortfall and let the prize pool publish underfunded.
    let remaining_slots = (tournament.total_players as u64)
        .saturating_sub(tournament.players.len() as u64);
    let total_expected_entry_net = entry_net_per_player
        .checked_mul(remaining_slots)
        .ok_or(TournamentError::OverFlow)?;
    let projected_net_total = available_net_now
        .checked_add(total_expected_entry_net)
        .ok_or(TournamentError::OverFlow)?;

    let needed_amount = total_prize_sum.saturating_sub(projected_net_total);
    if needed_amount > 0 {
        // Creator tops up the exact prize shortfall directly — this top-up isn't
        // an entry fee or sponsorship, so it isn't subject to the platform fee.
        let cpi_ctx = CpiContext::new(
            ctx.accounts.token_program.to_account_info().clone(),
            Transfer {
                from: creator_token_account.to_account_info().clone(),
                to: tournament_token_account.to_account_info().clone(),
                authority: creator.to_account_info().clone(),
            },
        );
        anchor_spl::token::transfer(cpi_ctx, needed_amount)?;
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

    // A paused tournament is being cancelled — refunds are already going out.
    // New money landing here would re-block the teardown (the final cancel step
    // requires sponsor_amount == 0) and risks being swept to the creator.
    require!(!tournament.is_paused, TournamentError::SponsorshipClosed);

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

    // Sponsor money is subject to the platform fee too, same as entry fees —
    // booked here, actually swept to TREASURY at close_tournament.
    let sponsor_fee = compute_net_bps(sponsor_amount, tournament.platform_fee_bps, TOTAL_BPS)
        .map(|net| sponsor_amount - net)
        .ok_or(TournamentError::OverFlow)?;
    tournament.pending_fees = tournament
        .pending_fees
        .checked_add(sponsor_fee)
        .ok_or(TournamentError::OverFlow)?;

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

    /// CHECK: must equal the program's TREASURY constant
    #[account(constraint = treasury.key() == TREASURY @ TournamentError::InvalidTreasury)]
    pub treasury: AccountInfo<'info>,

    #[account(
        init_if_needed,
        payer = driver,
        associated_token::mint = mint,
        associated_token::authority = treasury,
    )]
    pub treasury_token_account: Account<'info, TokenAccount>,

    #[account(mut, constraint = driver.key().eq(&DRIVER))]
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
    let treasury_token_account = &mut ctx.accounts.treasury_token_account;
    let driver = &ctx.accounts.driver;
    let tournament_token_account = &mut ctx.accounts.tournament_token_account;

    // A paused tournament must unwind through the refund path
    // (refund_joining_fees / refund_sponsor / refund_creator_and_cancel), not
    // sweep to the treasury and creator with players still owed their entry fees.
    require!(!tournament.is_paused, TournamentError::TournamentIsPaused);

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
            // Every recorded entry must be settled before the pot can be swept:
            // either it was paid out, or that player advanced and gets paid in
            // the round they actually go out in. Counting claims instead let a
            // round close with prizes still owed (round 0 never checked at all,
            // and rounds of 4+ passed on a single claim), stranding winners
            // once the escrow is closed.
            for winner_status in round.winners_and_collected_status.values() {
                if !winner_status.claimed && !winner_status.won_next_round {
                    return Err(TournamentError::PrizeNotClaimed.into());
                }
            }
        }
    }

    // Send remaining tokens to the specific address
    let total_balance = tournament_token_account.amount;

    // Sweep the platform's cut first, then whatever's left goes to the creator.
    // Clamp to total_balance as a belt-and-braces guard — bookkeeping should
    // always keep pending_fees <= total_balance, this just stops an underflow
    // panic if it ever drifted.
    let fee_amount = tournament.pending_fees.min(total_balance);
    let remaining_balance = total_balance - fee_amount;
    tournament.pending_fees = 0;

    let tournament_seed = &[
        TOURNAMENT_TAG.as_ref(),
        &tournament.tournament_id.as_ref(),
        &[tournament.bump],
    ];
    let cpi_signer = &[&tournament_seed[..]];

    if fee_amount > 0 {
        let cpi_ctx = CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info().clone(),
            Transfer {
                from: tournament_token_account.to_account_info(),
                to: treasury_token_account.to_account_info(),
                authority: tournament.to_account_info(),
            },
            cpi_signer,
        );
        anchor_spl::token::transfer(cpi_ctx, fee_amount)?;
    }

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

#[derive(Accounts)]
pub struct AnnounceTournament<'info> {
    #[account(constraint = driver.key().eq(&DRIVER))]
    pub driver: Signer<'info>,
    
    #[account(mut)]
    pub tournament: Account<'info, Tournament>,
}

pub fn announce_tournament(
    ctx: Context<AnnounceTournament>
) -> Result<()> {
    let tournament = &mut ctx.accounts.tournament;

    // Announcing locks the roster (leave_tournament is blocked afterwards), so
    // the prize ladder has to already be set and funded — otherwise players are
    // committed before they can see what they are playing for.
    require!(
        tournament.is_published,
        TournamentError::TournamentNotPublished
    );

    tournament.is_announced = true;
    msg!("Tournament has been announced");
    Ok(())
}
