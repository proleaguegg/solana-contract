use anchor_lang::system_program;
use anchor_spl::{
    associated_token::AssociatedToken,
    token::{CloseAccount, Mint, Token, TokenAccount, Transfer},
};

use {crate::constant::*, anchor_lang::prelude::*};

#[derive(Accounts)]
pub struct DestroyTournament<'info> {
    /// CHECK: We are checking it in the body
    #[account(mut)]
    pub tournament: AccountInfo<'info>,

    #[account(mut,
        constraint = tournament_token_account.mint == mint.key() && tournament_token_account.owner == tournament.key(),
    )]
    pub tournament_token_account: Account<'info, TokenAccount>,

    /// CHECK: We are checking it in the body
    #[account(mut)]
    pub creator: AccountInfo<'info>,

    #[account(mut,
        constraint = creator_token_account.mint == mint.key() && creator_token_account.owner == creator.key(),
    )]
    pub creator_token_account: Account<'info, TokenAccount>,

    #[account(constraint = driver.key().eq(&DRIVER))]
    pub driver: Signer<'info>,

    #[account(mut, constraint = mint.key().eq(&CURRENCY_MINT))]
    pub mint: Account<'info, Mint>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug)]
pub struct DestroyTournamentArgs {
    pub bump: u8,
    pub tournament_id: String,
}
pub fn destroy_tournament(
    ctx: Context<DestroyTournament>,
    data: DestroyTournamentArgs,
) -> Result<()> {
    let tournament_acc_info = &mut ctx.accounts.tournament;
    let tournament_seed = &[
        TOURNAMENT_TAG.as_ref(),
        &data.tournament_id.as_ref(),
        &[data.bump],
    ];

    let tournament_key = Pubkey::create_program_address(tournament_seed, ctx.program_id).unwrap();
    if !tournament_key.eq(&tournament_acc_info.key) {
        panic!(
            "Tournament key mismatch, expected {}, derived {}",
            tournament_acc_info.key, tournament_key
        );
    }
    let creator_token_account = &mut ctx.accounts.creator_token_account;
    let driver = &mut ctx.accounts.driver;
    let tournament_token_account = &mut ctx.accounts.tournament_token_account;
    let remaining_balance = tournament_token_account.amount;
    let cpi_signer = &[&tournament_seed[..]];

    if remaining_balance > 0 {
        // Transfer the escrow balance from the tournament to the creator (vault)
        let cpi_ctx = CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info().clone(),
            Transfer {
                from: tournament_token_account.to_account_info(),
                to: creator_token_account.to_account_info(),
                authority: tournament_acc_info.to_account_info(),
            },
            cpi_signer,
        );
        anchor_spl::token::transfer(cpi_ctx, remaining_balance)?;
    }

    // Close Tournament Token Account
    let cpi_ctx = CpiContext::new_with_signer(
        ctx.accounts.token_program.to_account_info().clone(),
        CloseAccount {
            account: tournament_token_account.to_account_info(),
            destination: driver.to_account_info(),
            authority: tournament_acc_info.to_account_info(),
        },
        cpi_signer,
    );
    anchor_spl::token::close_account(cpi_ctx)?;

    // Close Tournament Account
    close(tournament_acc_info, driver.to_account_info())
        .map_err(|e| e.with_account_name("tournament"))?;
    msg!("Tournament Refund and Close Sucessfully.");

    Ok(())
}

pub fn close<'info>(
    info: &mut AccountInfo<'info>,
    sol_destination: AccountInfo<'info>,
) -> Result<()> {
    // Transfer tokens from the account to the sol_destination.
    let dest_starting_lamports = sol_destination.lamports();
    **sol_destination.lamports.borrow_mut() =
        dest_starting_lamports.checked_add(info.lamports()).unwrap();
    **info.lamports.borrow_mut() = 0;

    info.assign(&system_program::ID);
    info.realloc(0, false).map_err(Into::into)
}
