use anchor_spl::{
    associated_token::AssociatedToken,
    token::{Mint, Token, TokenAccount, Transfer},
};

use {
    crate::{
        constant::*,
        errors::LeaderboardError,
        instructions::leaderboard_instructions::compute_fee,
        state::*,
    },
    anchor_lang::prelude::*,
};

// ----- join_leaderboard -----

#[derive(Accounts)]
pub struct JoinLeaderboard<'info> {
    #[account(mut, constraint = driver.key().eq(&DRIVER) @ LeaderboardError::Unauthorized)]
    pub driver: Signer<'info>,

    #[account(mut)]
    pub player: Signer<'info>,

    #[account(
        init_if_needed,
        payer = driver,
        associated_token::mint = mint,
        associated_token::authority = player,
    )]
    pub player_token_account: Account<'info, TokenAccount>,

    #[account(mut, has_one = mint @ LeaderboardError::InvalidMint)]
    pub leaderboard: Account<'info, Leaderboard>,

    #[account(
        mut,
        associated_token::mint = mint,
        associated_token::authority = leaderboard,
    )]
    pub leaderboard_token_account: Account<'info, TokenAccount>,

    #[account(
        init_if_needed,
        payer = driver,
        space = Participant::LEN,
        seeds = [
            PARTICIPANT_TAG.as_ref(),
            leaderboard.key().as_ref(),
            player.key().as_ref(),
        ],
        bump,
    )]
    pub participant: Account<'info, Participant>,

    pub mint: Account<'info, Mint>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

pub fn join_leaderboard(ctx: Context<JoinLeaderboard>) -> Result<()> {
    let lb = &mut ctx.accounts.leaderboard;

    require!(
        lb.state == LeaderboardState::Open,
        LeaderboardError::LeaderboardNotOpen
    );

    // Re-join detection: a freshly init_if_needed'd account has all-zero data.
    // joined_at is set to a non-zero unix timestamp on first join, so it is the
    // safest sentinel.
    require!(
        ctx.accounts.participant.joined_at == 0,
        LeaderboardError::PlayerAlreadyJoined
    );

    let now = Clock::get()?.unix_timestamp;
    require!(now < lb.start_timestamp, LeaderboardError::RegistrationClosed);

    require!(
        lb.participant_count < lb.max_participants,
        LeaderboardError::ParticipantLimitReached
    );

    let gross = lb.buy_in_amount;
    let net = lb.buy_in_net;
    let fee = compute_fee(gross, lb.platform_fee_bps)?;

    if gross > 0 {
        let cpi_ctx = CpiContext::new(
            ctx.accounts.token_program.to_account_info(),
            Transfer {
                from: ctx.accounts.player_token_account.to_account_info(),
                to: ctx.accounts.leaderboard_token_account.to_account_info(),
                authority: ctx.accounts.player.to_account_info(),
            },
        );
        anchor_spl::token::transfer(cpi_ctx, gross)?;
    }

    lb.prize_pool = lb
        .prize_pool
        .checked_add(net)
        .ok_or(LeaderboardError::OverFlow)?;
    lb.pending_fees = lb
        .pending_fees
        .checked_add(fee)
        .ok_or(LeaderboardError::OverFlow)?;
    lb.participant_count = lb
        .participant_count
        .checked_add(1)
        .ok_or(LeaderboardError::OverFlow)?;

    let participant = &mut ctx.accounts.participant;
    participant.bump = ctx.bumps.participant;
    participant.leaderboard = lb.key();
    participant.player = ctx.accounts.player.key();
    participant.gross_contribution = gross;
    participant.net_contribution = net;
    participant.joined_at = now;

    Ok(())
}

// ----- leave_leaderboard -----

#[derive(Accounts)]
pub struct LeaveLeaderboard<'info> {
    #[account(mut, constraint = driver.key().eq(&DRIVER) @ LeaderboardError::Unauthorized)]
    pub driver: Signer<'info>,

    /// CHECK: identifies who to refund
    #[account(mut)]
    pub player: AccountInfo<'info>,

    #[account(
        init_if_needed,
        payer = driver,
        associated_token::mint = mint,
        associated_token::authority = player,
    )]
    pub player_token_account: Account<'info, TokenAccount>,

    #[account(mut, has_one = mint @ LeaderboardError::InvalidMint)]
    pub leaderboard: Account<'info, Leaderboard>,

    #[account(
        mut,
        associated_token::mint = mint,
        associated_token::authority = leaderboard,
    )]
    pub leaderboard_token_account: Account<'info, TokenAccount>,

    #[account(
        mut,
        close = driver,
        seeds = [
            PARTICIPANT_TAG.as_ref(),
            leaderboard.key().as_ref(),
            player.key().as_ref(),
        ],
        bump = participant.bump,
        constraint = participant.leaderboard == leaderboard.key()
            && participant.player == player.key()
            @ LeaderboardError::PlayerNotEnrolled,
    )]
    pub participant: Account<'info, Participant>,

    pub mint: Account<'info, Mint>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

pub fn leave_leaderboard(ctx: Context<LeaveLeaderboard>) -> Result<()> {
    let lb = &mut ctx.accounts.leaderboard;

    require!(
        lb.state == LeaderboardState::Open,
        LeaderboardError::LeaderboardNotOpen
    );
    let now = Clock::get()?.unix_timestamp;
    require!(now < lb.start_timestamp, LeaderboardError::RegistrationClosed);

    let participant = &ctx.accounts.participant;
    let gross = participant.gross_contribution;
    let net = participant.net_contribution;
    let fee = gross.checked_sub(net).ok_or(LeaderboardError::OverFlow)?;

    if gross > 0 {
        let id_bytes = lb.leaderboard_id.as_bytes();
        let signer_seeds: &[&[u8]] = &[LEADERBOARD_TAG.as_ref(), id_bytes, &[lb.bump]];
        let signer = &[signer_seeds];

        let cpi_ctx = CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            Transfer {
                from: ctx.accounts.leaderboard_token_account.to_account_info(),
                to: ctx.accounts.player_token_account.to_account_info(),
                authority: lb.to_account_info(),
            },
            signer,
        );
        anchor_spl::token::transfer(cpi_ctx, gross)?;
    }

    lb.prize_pool = lb
        .prize_pool
        .checked_sub(net)
        .ok_or(LeaderboardError::OverFlow)?;
    lb.pending_fees = lb
        .pending_fees
        .checked_sub(fee)
        .ok_or(LeaderboardError::OverFlow)?;
    lb.participant_count = lb
        .participant_count
        .checked_sub(1)
        .ok_or(LeaderboardError::OverFlow)?;

    Ok(())
}
