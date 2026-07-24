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

// ----- deposit_sponsorship -----

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug)]
pub struct DepositSponsorshipArgs {
    pub amount: u64,
}

#[derive(Accounts)]
pub struct DepositSponsorship<'info> {
    #[account(mut, constraint = driver.key().eq(&DRIVER) @ LeaderboardError::Unauthorized)]
    pub driver: Signer<'info>,

    #[account(mut)]
    pub sponsor: Signer<'info>,

    #[account(
        mut,
        constraint = sponsor_token_account.mint == mint.key()
            && sponsor_token_account.owner == sponsor.key(),
    )]
    pub sponsor_token_account: Account<'info, TokenAccount>,

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
        space = Sponsor::LEN,
        seeds = [
            SPONSOR_TAG.as_ref(),
            leaderboard.key().as_ref(),
            sponsor.key().as_ref(),
        ],
        bump,
    )]
    pub sponsor_account: Account<'info, Sponsor>,

    pub mint: Account<'info, Mint>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

pub fn deposit_sponsorship(
    ctx: Context<DepositSponsorship>,
    args: DepositSponsorshipArgs,
) -> Result<()> {
    let lb = &mut ctx.accounts.leaderboard;

    require!(
        lb.state == LeaderboardState::Open,
        LeaderboardError::LeaderboardNotOpen
    );
    require!(args.amount > 0, LeaderboardError::OverFlow);

    let now = Clock::get()?.unix_timestamp;
    let cutoff_ts = lb
        .end_timestamp
        .checked_sub(lb.sponsor_cutoff)
        .ok_or(LeaderboardError::OverFlow)?;
    require!(now < cutoff_ts, LeaderboardError::SponsorshipClosed);

    let fee = compute_fee(args.amount, lb.platform_fee_bps)?;
    let net = args
        .amount
        .checked_sub(fee)
        .ok_or(LeaderboardError::OverFlow)?;

    let cpi_ctx = CpiContext::new(
        ctx.accounts.token_program.to_account_info(),
        Transfer {
            from: ctx.accounts.sponsor_token_account.to_account_info(),
            to: ctx.accounts.leaderboard_token_account.to_account_info(),
            authority: ctx.accounts.sponsor.to_account_info(),
        },
    );
    anchor_spl::token::transfer(cpi_ctx, args.amount)?;

    lb.prize_pool = lb
        .prize_pool
        .checked_add(net)
        .ok_or(LeaderboardError::OverFlow)?;
    lb.pending_fees = lb
        .pending_fees
        .checked_add(fee)
        .ok_or(LeaderboardError::OverFlow)?;

    let sponsor_acc = &mut ctx.accounts.sponsor_account;
    let is_new = sponsor_acc.gross_contribution == 0 && sponsor_acc.net_contribution == 0;
    if is_new {
        sponsor_acc.bump = ctx.bumps.sponsor_account;
        sponsor_acc.leaderboard = lb.key();
        sponsor_acc.sponsor = ctx.accounts.sponsor.key();
        lb.sponsor_count = lb
            .sponsor_count
            .checked_add(1)
            .ok_or(LeaderboardError::OverFlow)?;
    }

    sponsor_acc.gross_contribution = sponsor_acc
        .gross_contribution
        .checked_add(args.amount)
        .ok_or(LeaderboardError::OverFlow)?;
    sponsor_acc.net_contribution = sponsor_acc
        .net_contribution
        .checked_add(net)
        .ok_or(LeaderboardError::OverFlow)?;
    sponsor_acc.last_deposit_at = now;

    Ok(())
}

// ----- refund_sponsor -----

#[derive(Accounts)]
pub struct RefundLeaderboardSponsor<'info> {
    #[account(mut, constraint = driver.key().eq(&DRIVER) @ LeaderboardError::Unauthorized)]
    pub driver: Signer<'info>,

    /// CHECK: identifies sponsor wallet for refund
    #[account(mut)]
    pub sponsor: AccountInfo<'info>,

    #[account(
        init_if_needed,
        payer = driver,
        associated_token::mint = mint,
        associated_token::authority = sponsor,
    )]
    pub sponsor_token_account: Account<'info, TokenAccount>,

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
            SPONSOR_TAG.as_ref(),
            leaderboard.key().as_ref(),
            sponsor.key().as_ref(),
        ],
        bump = sponsor_account.bump,
        constraint = sponsor_account.leaderboard == leaderboard.key()
            && sponsor_account.sponsor == sponsor.key()
            @ LeaderboardError::SponsorNotFound,
    )]
    pub sponsor_account: Account<'info, Sponsor>,

    pub mint: Account<'info, Mint>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

pub fn refund_leaderboard_sponsor(ctx: Context<RefundLeaderboardSponsor>) -> Result<()> {
    let lb = &mut ctx.accounts.leaderboard;
    require!(
        lb.state == LeaderboardState::Cancelled,
        LeaderboardError::LeaderboardNotCancelled
    );

    let sponsor_acc = &ctx.accounts.sponsor_account;
    let gross = sponsor_acc.gross_contribution;
    let net = sponsor_acc.net_contribution;
    let fee = gross.checked_sub(net).ok_or(LeaderboardError::OverFlow)?;

    if gross > 0 {
        let id_bytes = lb.leaderboard_id.as_bytes();
        let signer_seeds: &[&[u8]] = &[LEADERBOARD_TAG.as_ref(), id_bytes, &[lb.bump]];
        let signer = &[signer_seeds];

        let cpi_ctx = CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            Transfer {
                from: ctx.accounts.leaderboard_token_account.to_account_info(),
                to: ctx.accounts.sponsor_token_account.to_account_info(),
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
    lb.refunded_sponsor_count = lb
        .refunded_sponsor_count
        .checked_add(1)
        .ok_or(LeaderboardError::OverFlow)?;

    Ok(())
}
