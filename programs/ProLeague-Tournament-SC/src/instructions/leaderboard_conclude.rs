use anchor_spl::{
    associated_token::AssociatedToken,
    token::{CloseAccount, Mint, Token, TokenAccount, Transfer},
};

use {
    crate::{constant::*, errors::LeaderboardError, state::*},
    anchor_lang::prelude::*,
};

// ----- conclude_leaderboard -----

#[derive(Accounts)]
pub struct ConcludeLeaderboard<'info> {
    #[account(mut, constraint = driver.key().eq(&DRIVER) @ LeaderboardError::Unauthorized)]
    pub driver: Signer<'info>,

    #[account(mut, has_one = mint @ LeaderboardError::InvalidMint)]
    pub leaderboard: Account<'info, Leaderboard>,

    #[account(
        mut,
        associated_token::mint = mint,
        associated_token::authority = leaderboard,
    )]
    pub leaderboard_token_account: Account<'info, TokenAccount>,

    /// CHECK: must equal the program's TREASURY constant
    #[account(constraint = treasury.key() == TREASURY @ LeaderboardError::InvalidTreasury)]
    pub treasury: AccountInfo<'info>,

    #[account(
        init_if_needed,
        payer = driver,
        associated_token::mint = mint,
        associated_token::authority = treasury,
    )]
    pub treasury_token_account: Account<'info, TokenAccount>,

    pub mint: Account<'info, Mint>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

pub fn conclude_leaderboard(ctx: Context<ConcludeLeaderboard>) -> Result<()> {
    let lb = &mut ctx.accounts.leaderboard;

    match lb.state {
        LeaderboardState::Open => {}
        LeaderboardState::Concluded => {
            return Err(LeaderboardError::LeaderboardAlreadyConcluded.into())
        }
        LeaderboardState::Cancelled => {
            return Err(LeaderboardError::LeaderboardAlreadyCancelled.into())
        }
        LeaderboardState::Draft => return Err(LeaderboardError::LeaderboardNotOpen.into()),
    }

    let now = Clock::get()?.unix_timestamp;
    require!(now >= lb.end_timestamp, LeaderboardError::LeaderboardNotEnded);
    require!(
        lb.participant_count >= lb.min_participants,
        LeaderboardError::BelowMinParticipants
    );

    if lb.pending_fees > 0 {
        let id_bytes = lb.leaderboard_id.as_bytes();
        let signer_seeds: &[&[u8]] = &[LEADERBOARD_TAG.as_ref(), id_bytes, &[lb.bump]];
        let signer = &[signer_seeds];

        let cpi_ctx = CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            Transfer {
                from: ctx.accounts.leaderboard_token_account.to_account_info(),
                to: ctx.accounts.treasury_token_account.to_account_info(),
                authority: lb.to_account_info(),
            },
            signer,
        );
        anchor_spl::token::transfer(cpi_ctx, lb.pending_fees)?;
    }

    lb.pending_fees = 0;
    lb.state = LeaderboardState::Concluded;
    lb.concluded_at = now;

    Ok(())
}

// ----- send_prize_leaderboard -----

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug)]
pub struct SendLeaderboardPrizeArgs {
    pub slot_index: u16,
}

#[derive(Accounts)]
pub struct SendLeaderboardPrize<'info> {
    #[account(mut, constraint = driver.key().eq(&DRIVER) @ LeaderboardError::Unauthorized)]
    pub driver: Signer<'info>,

    /// CHECK: identifies winner; bound to participant via seeds
    #[account(mut)]
    pub winner: AccountInfo<'info>,

    #[account(
        init_if_needed,
        payer = driver,
        associated_token::mint = mint,
        associated_token::authority = winner,
    )]
    pub winner_token_account: Account<'info, TokenAccount>,

    #[account(mut, has_one = mint @ LeaderboardError::InvalidMint)]
    pub leaderboard: Account<'info, Leaderboard>,

    #[account(
        mut,
        associated_token::mint = mint,
        associated_token::authority = leaderboard,
    )]
    pub leaderboard_token_account: Account<'info, TokenAccount>,

    #[account(
        seeds = [
            PARTICIPANT_TAG.as_ref(),
            leaderboard.key().as_ref(),
            winner.key().as_ref(),
        ],
        bump = participant.bump,
        constraint = participant.leaderboard == leaderboard.key()
            && participant.player == winner.key()
            @ LeaderboardError::WinnerNotEnrolled,
    )]
    pub participant: Account<'info, Participant>,

    pub mint: Account<'info, Mint>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

pub fn send_prize_leaderboard(
    ctx: Context<SendLeaderboardPrize>,
    args: SendLeaderboardPrizeArgs,
) -> Result<()> {
    let lb = &mut ctx.accounts.leaderboard;

    require!(
        lb.state == LeaderboardState::Concluded,
        LeaderboardError::LeaderboardNotConcluded
    );

    let slot_count = lb.payout_slots_bps.len() as u16;
    require!(args.slot_index < slot_count, LeaderboardError::SlotIndexOutOfOrder);

    if args.slot_index < lb.paid_slots {
        return Err(LeaderboardError::WinnerAlreadyPaid.into());
    }
    require!(
        args.slot_index == lb.paid_slots,
        LeaderboardError::SlotIndexOutOfOrder
    );

    let bps = lb.payout_slots_bps[args.slot_index as usize];
    // All slots use the same formula. Any rounding dust is swept to TREASURY at close.
    let share: u64 = (lb.prize_pool as u128)
        .checked_mul(bps as u128)
        .and_then(|v| v.checked_div(TOTAL_BPS as u128))
        .and_then(|v| u64::try_from(v).ok())
        .ok_or(LeaderboardError::OverFlow)?;

    if share > 0 {
        let id_bytes = lb.leaderboard_id.as_bytes();
        let signer_seeds: &[&[u8]] = &[LEADERBOARD_TAG.as_ref(), id_bytes, &[lb.bump]];
        let signer = &[signer_seeds];

        let cpi_ctx = CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            Transfer {
                from: ctx.accounts.leaderboard_token_account.to_account_info(),
                to: ctx.accounts.winner_token_account.to_account_info(),
                authority: lb.to_account_info(),
            },
            signer,
        );
        anchor_spl::token::transfer(cpi_ctx, share)?;
    }

    lb.paid_slots = lb
        .paid_slots
        .checked_add(1)
        .ok_or(LeaderboardError::OverFlow)?;

    Ok(())
}

// ----- refund_player -----

#[derive(Accounts)]
pub struct RefundLeaderboardPlayer<'info> {
    #[account(mut, constraint = driver.key().eq(&DRIVER) @ LeaderboardError::Unauthorized)]
    pub driver: Signer<'info>,

    /// CHECK: identifies player wallet for refund
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

pub fn refund_leaderboard_player(ctx: Context<RefundLeaderboardPlayer>) -> Result<()> {
    let lb = &mut ctx.accounts.leaderboard;
    require!(
        lb.state == LeaderboardState::Cancelled,
        LeaderboardError::LeaderboardNotCancelled
    );

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
    lb.refunded_player_count = lb
        .refunded_player_count
        .checked_add(1)
        .ok_or(LeaderboardError::OverFlow)?;

    Ok(())
}

// ----- close_leaderboard -----

#[derive(Accounts)]
pub struct CloseLeaderboard<'info> {
    #[account(mut, constraint = driver.key().eq(&DRIVER) @ LeaderboardError::Unauthorized)]
    pub driver: Signer<'info>,

    /// CHECK: must equal program TREASURY (catches any remaining dust)
    #[account(mut, constraint = treasury.key() == TREASURY @ LeaderboardError::InvalidTreasury)]
    pub treasury: AccountInfo<'info>,

    #[account(
        init_if_needed,
        payer = driver,
        associated_token::mint = mint,
        associated_token::authority = treasury,
    )]
    pub treasury_token_account: Account<'info, TokenAccount>,

    #[account(
        mut,
        close = driver,
        has_one = mint @ LeaderboardError::InvalidMint,
        seeds = [LEADERBOARD_TAG.as_ref(), leaderboard.leaderboard_id.as_bytes()],
        bump = leaderboard.bump,
    )]
    pub leaderboard: Account<'info, Leaderboard>,

    #[account(
        mut,
        associated_token::mint = mint,
        associated_token::authority = leaderboard,
    )]
    pub leaderboard_token_account: Account<'info, TokenAccount>,

    pub mint: Account<'info, Mint>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

pub fn close_leaderboard(ctx: Context<CloseLeaderboard>) -> Result<()> {
    let lb = &ctx.accounts.leaderboard;

    match lb.state {
        LeaderboardState::Concluded => {
            require!(
                lb.paid_slots as usize == lb.payout_slots_bps.len(),
                LeaderboardError::PayoutsNotComplete
            );
        }
        LeaderboardState::Cancelled => {
            require!(
                lb.refunded_player_count == lb.participant_count
                    && lb.refunded_sponsor_count == lb.sponsor_count,
                LeaderboardError::RefundsNotComplete
            );
        }
        _ => return Err(error!(LeaderboardError::Unauthorized)),
    }

    let id_bytes = lb.leaderboard_id.as_bytes();
    let signer_seeds: &[&[u8]] = &[LEADERBOARD_TAG.as_ref(), id_bytes, &[lb.bump]];
    let signer = &[signer_seeds];

    let remaining = ctx.accounts.leaderboard_token_account.amount;
    if remaining > 0 {
        let cpi_ctx = CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            Transfer {
                from: ctx.accounts.leaderboard_token_account.to_account_info(),
                to: ctx.accounts.treasury_token_account.to_account_info(),
                authority: lb.to_account_info(),
            },
            signer,
        );
        anchor_spl::token::transfer(cpi_ctx, remaining)?;
    }

    let cpi_ctx = CpiContext::new_with_signer(
        ctx.accounts.token_program.to_account_info(),
        CloseAccount {
            account: ctx.accounts.leaderboard_token_account.to_account_info(),
            destination: ctx.accounts.driver.to_account_info(),
            authority: lb.to_account_info(),
        },
        signer,
    );
    anchor_spl::token::close_account(cpi_ctx)?;

    Ok(())
}
