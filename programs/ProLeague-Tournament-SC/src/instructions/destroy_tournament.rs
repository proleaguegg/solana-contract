use anchor_lang::system_program;
use anchor_spl::{
    associated_token::AssociatedToken,
    token::{CloseAccount, Mint, Token, TokenAccount, Transfer},
};

use {
    crate::{constant::*, errors::TournamentError},
    anchor_lang::prelude::*,
};

// Tournament layout starts with discriminator (8) + bump (1) + creator (32).
// Read the creator from raw bytes so recovery still works on an account whose
// later fields no longer deserialize after a layout change.
const CREATOR_OFFSET: usize = 8 + 1;

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
    #[account()]
    pub creator: AccountInfo<'info>,

    #[account(mut,
        constraint = creator_token_account.mint == mint.key() && creator_token_account.owner == creator.key(),
    )]
    pub creator_token_account: Option<Account<'info, TokenAccount>>,

    /// Recovery tool: gated by the program upgrade authority in lib.rs, not the
    /// hot DRIVER key, so a leaked driver key cannot tear down live escrows.
    #[account(mut)]
    pub authority: Signer<'info>,

    /// CHECK: verified against the program account in assert_program_authority
    #[account()]
    pub program_data: AccountInfo<'info>,

    /// CHECK: must be this program
    #[account(address = crate::id())]
    pub program: AccountInfo<'info>,

    #[account()]
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

    let tournament_key = Pubkey::create_program_address(tournament_seed, ctx.program_id)
        .map_err(|_| TournamentError::InvalidProgram)?;
    require_keys_eq!(
        tournament_key,
        *tournament_acc_info.key,
        TournamentError::InvalidProgram
    );
    require_keys_eq!(
        *tournament_acc_info.owner,
        crate::id(),
        TournamentError::InvalidProgram
    );

    // Escrow may only go back to the creator recorded on the tournament.
    let recorded_creator = {
        let data = tournament_acc_info.try_borrow_data()?;
        require!(
            data.len() >= CREATOR_OFFSET + 32,
            TournamentError::InvalidProgram
        );
        Pubkey::try_from(&data[CREATOR_OFFSET..CREATOR_OFFSET + 32])
            .map_err(|_| TournamentError::InvalidProgram)?
    };
    require_keys_eq!(
        ctx.accounts.creator.key(),
        recorded_creator,
        TournamentError::WrongCreator
    );

    let authority = &mut ctx.accounts.authority;
    let tournament_token_account = &mut ctx.accounts.tournament_token_account;
    let creator_token_account = &mut ctx.accounts.creator_token_account;
    let remaining_balance = tournament_token_account.amount;
    let cpi_signer = &[&tournament_seed[..]];

    if remaining_balance > 0 {
        if let Some(creator_account) = creator_token_account {
            // Transfer the escrow balance from the tournament to the creator (vault)
            let cpi_ctx = CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info().clone(),
                Transfer {
                    from: tournament_token_account.to_account_info(),
                    to: creator_account.to_account_info(),
                    authority: tournament_acc_info.to_account_info(),
                },
                cpi_signer,
            );
            anchor_spl::token::transfer(cpi_ctx, remaining_balance)?;
        }
    }

    // Close Tournament Token Account
    let cpi_ctx = CpiContext::new_with_signer(
        ctx.accounts.token_program.to_account_info().clone(),
        CloseAccount {
            account: tournament_token_account.to_account_info(),
            destination: authority.to_account_info(),
            authority: tournament_acc_info.to_account_info(),
        },
        cpi_signer,
    );
    anchor_spl::token::close_account(cpi_ctx)?;

    // Close Tournament Account
    close(tournament_acc_info, authority.to_account_info())
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
