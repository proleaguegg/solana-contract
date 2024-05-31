use {
    crate::{constant::*, state::*, utils::reallocate_bytes},
    anchor_lang::prelude::*,
};

#[derive(Accounts)]
pub struct ReallocateTournament<'info> {
    #[account(constraint = driver.key().eq(&DRIVER))]
    pub driver: Signer<'info>,

    #[account(mut)]
    pub tournament: Account<'info, Tournament>,

    pub rent_sysvar: Sysvar<'info, Rent>,
    pub system_program: Program<'info, System>,
}

pub fn reallocate_tournament(ctx: Context<ReallocateTournament>) -> Result<()> {
    let tournament = &mut ctx.accounts.tournament;
    let driver = &ctx.accounts.driver;

    let existing_size = tournament.to_account_info().data_len();
    let required_size = Tournament::calculate_size(
        tournament.total_players,
        (tournament.total_players as f32).log2() as u16,
    );

    msg!(
        "Existing and Required Size: {:?}! {:?}!",
        existing_size,
        required_size
    );

    if required_size > existing_size {
        // Reallocate the switch account with the new length.
        reallocate_bytes(
            (required_size - existing_size) as isize,
            tournament.to_account_info(),
            driver.to_account_info(),
            &ctx.accounts.rent_sysvar,
            &ctx.accounts.system_program,
        )?;
        msg!("Account realocate success");
    } else {
        msg!("No Need to allocate space");
    }
    Ok(())
}
