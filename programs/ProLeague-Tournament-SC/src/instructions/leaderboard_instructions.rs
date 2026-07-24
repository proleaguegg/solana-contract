use anchor_lang::solana_program::{program::invoke, system_instruction::transfer};
use anchor_spl::{
    associated_token::AssociatedToken,
    token::{Mint, Token, TokenAccount},
};

use {
    crate::{constant::*, errors::LeaderboardError, state::*},
    anchor_lang::prelude::*,
};

// ----- Args -----

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug)]
pub struct InitializeLeaderboardArgs {
    pub leaderboard_id: String,
    pub start_timestamp: i64,
    pub end_timestamp: i64,
    pub sponsor_cutoff: i64,
    pub buy_in_amount: u64,
    pub min_participants: u16,
    pub max_participants: u16,
    pub payout_slots_bps: Vec<u16>,
    pub platform_fee_bps: u16,
}

// ----- initialize_leaderboard -----

#[derive(Accounts)]
#[instruction(args: InitializeLeaderboardArgs)]
pub struct InitializeLeaderboard<'info> {
    #[account(mut, constraint = driver.key().eq(&DRIVER) @ LeaderboardError::Unauthorized)]
    pub driver: Signer<'info>,

    /// CHECK: bound to creator_info via constraint
    #[account(mut, constraint = creator.key().eq(&creator_info.key()))]
    pub creator: Option<Signer<'info>>,

    /// CHECK: persisted as leaderboard.creator
    #[account(mut)]
    pub creator_info: AccountInfo<'info>,

    #[account(seeds = [GLOBAL_TAG.as_ref(), crate::id().as_ref()], bump = global.bump)]
    pub global: Account<'info, Global>,

    #[account(
        init,
        seeds = [LEADERBOARD_TAG.as_ref(), args.leaderboard_id.as_ref()],
        bump,
        payer = driver,
        space = Leaderboard::LEN,
    )]
    pub leaderboard: Account<'info, Leaderboard>,

    #[account(
        init,
        payer = driver,
        associated_token::mint = mint,
        associated_token::authority = leaderboard,
    )]
    pub leaderboard_token_account: Account<'info, TokenAccount>,

    pub mint: Account<'info, Mint>,

    pub associated_token_program: Program<'info, AssociatedToken>,
    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

pub fn initialize_leaderboard(
    ctx: Context<InitializeLeaderboard>,
    args: InitializeLeaderboardArgs,
) -> Result<()> {
    let now = Clock::get()?.unix_timestamp;

    // ----- validation -----

    require!(
        args.leaderboard_id.len() <= LEADERBOARD_ID_MAX_LEN as usize,
        LeaderboardError::LeaderboardIdTooLong
    );

    require!(now < args.start_timestamp, LeaderboardError::StartTimeInPast);

    let duration = args
        .end_timestamp
        .checked_sub(args.start_timestamp)
        .ok_or(LeaderboardError::InvalidTimeWindow)?;
    require!(
        duration >= MIN_LEADERBOARD_DURATION && duration <= MAX_LEADERBOARD_DURATION,
        LeaderboardError::InvalidTimeWindow
    );

    require!(
        args.sponsor_cutoff >= 0 && args.sponsor_cutoff < duration,
        LeaderboardError::SponsorCutoffInvalid
    );

    let slot_count = args.payout_slots_bps.len();
    require!(
        slot_count >= 1 && slot_count <= MAX_PAYOUT_SLOTS as usize,
        LeaderboardError::PayoutSlotsTooMany
    );
    let bps_sum: u32 = args.payout_slots_bps.iter().map(|b| *b as u32).sum();
    require!(bps_sum == TOTAL_BPS as u32, LeaderboardError::PayoutSumMismatch);

    require!(
        args.min_participants > 0
            && args.min_participants <= args.max_participants
            && args.min_participants as usize >= slot_count,
        LeaderboardError::InvalidMinMaxParticipants
    );

    require!(
        args.platform_fee_bps <= PLATFORM_FEE_BPS_MAX,
        LeaderboardError::InvalidFee
    );

    // mint whitelist (re-uses the existing tournament Global)
    let mint_key = ctx.accounts.mint.key();
    if !ctx.accounts.global.whitelist_mint.contains(&mint_key) {
        let creator = &ctx.accounts.creator_info;
        require!(creator.is_signer, LeaderboardError::Unauthorized);

        let ix = transfer(
            &creator.key(),
            &ctx.accounts.driver.key(),
            NON_WHITELISTED_CREATION_FEE,
        );
        invoke(
            &ix,
            &[
                creator.to_account_info(),
                ctx.accounts.driver.to_account_info(),
                ctx.accounts.system_program.to_account_info(),
            ],
        )?;
    }

    // ----- write state -----

    let lb = &mut ctx.accounts.leaderboard;
    lb.bump = ctx.bumps.leaderboard;
    lb.leaderboard_id = args.leaderboard_id;
    lb.creator = ctx.accounts.creator_info.key();
    lb.mint = mint_key;
    lb.start_timestamp = args.start_timestamp;
    lb.end_timestamp = args.end_timestamp;
    lb.sponsor_cutoff = args.sponsor_cutoff;
    lb.buy_in_amount = args.buy_in_amount;
    lb.buy_in_net = compute_net(args.buy_in_amount, args.platform_fee_bps)?;
    lb.platform_fee_bps = args.platform_fee_bps;
    lb.min_participants = args.min_participants;
    lb.max_participants = args.max_participants;
    lb.payout_slots_bps = args.payout_slots_bps;
    lb.state = LeaderboardState::Draft;
    lb.prize_pool = 0;
    lb.pending_fees = 0;
    lb.participant_count = 0;
    lb.sponsor_count = 0;
    lb.paid_slots = 0;
    lb.refunded_player_count = 0;
    lb.refunded_sponsor_count = 0;
    lb.concluded_at = 0;

    Ok(())
}

// ----- publish_leaderboard -----

#[derive(Accounts)]
pub struct PublishLeaderboard<'info> {
    #[account(constraint = driver.key().eq(&DRIVER) @ LeaderboardError::Unauthorized)]
    pub driver: Signer<'info>,

    #[account(constraint = creator.key().eq(&leaderboard.creator) @ LeaderboardError::Unauthorized)]
    pub creator: Signer<'info>,

    #[account(mut)]
    pub leaderboard: Account<'info, Leaderboard>,
}

pub fn publish_leaderboard(ctx: Context<PublishLeaderboard>) -> Result<()> {
    let lb = &mut ctx.accounts.leaderboard;
    match lb.state {
        LeaderboardState::Draft => {
            lb.state = LeaderboardState::Open;
            Ok(())
        }
        LeaderboardState::Open => Err(LeaderboardError::LeaderboardAlreadyPublished.into()),
        LeaderboardState::Concluded => Err(LeaderboardError::LeaderboardAlreadyConcluded.into()),
        LeaderboardState::Cancelled => Err(LeaderboardError::LeaderboardAlreadyCancelled.into()),
    }
}

// ----- cancel_leaderboard -----

#[derive(Accounts)]
pub struct CancelLeaderboard<'info> {
    #[account(constraint = driver.key().eq(&DRIVER) @ LeaderboardError::Unauthorized)]
    pub driver: Signer<'info>,

    /// CHECK: validated against leaderboard.creator when relevant
    #[account()]
    pub creator: Option<Signer<'info>>,

    #[account(mut)]
    pub leaderboard: Account<'info, Leaderboard>,
}

pub fn cancel_leaderboard(ctx: Context<CancelLeaderboard>) -> Result<()> {
    let lb = &mut ctx.accounts.leaderboard;

    match lb.state {
        LeaderboardState::Open => {}
        LeaderboardState::Cancelled => {
            return Err(LeaderboardError::LeaderboardAlreadyCancelled.into())
        }
        LeaderboardState::Concluded => {
            return Err(LeaderboardError::LeaderboardAlreadyConcluded.into())
        }
        LeaderboardState::Draft => return Err(LeaderboardError::LeaderboardNotOpen.into()),
    }

    let now = Clock::get()?.unix_timestamp;
    let pre_start = now < lb.start_timestamp;
    let under_min = !pre_start && lb.participant_count < lb.min_participants;

    // Either:
    //   * creator cancels before start, or
    //   * driver cancels under-min at/after start (predicate enforced).
    if pre_start {
        let creator = ctx
            .accounts
            .creator
            .as_ref()
            .ok_or(LeaderboardError::Unauthorized)?;
        require!(
            creator.key() == lb.creator,
            LeaderboardError::Unauthorized
        );
    } else {
        require!(under_min, LeaderboardError::Unauthorized);
    }

    lb.state = LeaderboardState::Cancelled;
    Ok(())
}

// ----- helpers -----

pub fn compute_net(gross: u64, fee_bps: u16) -> Result<u64> {
    let fee = compute_fee(gross, fee_bps)?;
    gross.checked_sub(fee).ok_or(LeaderboardError::OverFlow.into())
}

pub fn compute_fee(gross: u64, fee_bps: u16) -> Result<u64> {
    (gross as u128)
        .checked_mul(fee_bps as u128)
        .and_then(|v| v.checked_div(TOTAL_BPS as u128))
        .and_then(|v| u64::try_from(v).ok())
        .ok_or(LeaderboardError::OverFlow.into())
}
