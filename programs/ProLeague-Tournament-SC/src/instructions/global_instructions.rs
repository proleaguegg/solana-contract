use {
    crate::{constant::*, state::*, utils::reallocate_bytes},
    anchor_lang::prelude::*,
};

#[derive(Accounts)]
#[instruction(args: InitGlobalArgs)]
pub struct InitGlobal<'info> {
    /// Public info account
    #[account(
      init, 
      seeds = [GLOBAL_TAG.as_ref(), crate::id().as_ref()],
      bump,
      payer = authority,
      space = Global::get_size(args.list.len()),
    )]
    pub global: Account<'info, Global>,

    /// The update authority of the program
    #[account(mut)]
    pub authority: Signer<'info>,

    /// Program data accout
    /// CHECK: This is not dangerous
    #[account()]
    pub program_data: AccountInfo<'info>,

    /// Program accounnt
    /// CHECK: This is not dangerous
    #[account(address = crate::id())]
    pub program: AccountInfo<'info>,

    /// The system program.
    pub system_program: Program<'info, System>,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug, PartialEq)]
pub struct InitGlobalArgs {
    list: Vec<Pubkey>,
}

pub fn init_global(ctx: Context<InitGlobal>, args: InitGlobalArgs) -> Result<()> {
    let global = &mut ctx.accounts.global;
    global.set_defaults();
    global.bump = ctx.bumps.global;
    global.whitelist_mint = args.list;
    Ok(())
}

#[derive(Accounts)]
#[instruction(args: UpdateGlobalArgs)]
pub struct UpdateGlobal<'info> {
    /// Public info account
   #[account(seeds = [GLOBAL_TAG.as_ref(), crate::id().as_ref()],bump)]
    pub global: Account<'info, Global>,

    /// The update authority of the program
    #[account(mut)]
    pub authority: Signer<'info>,

    /// Program data accout
    /// CHECK: This is not dangerous
    #[account()]
    pub program_data: AccountInfo<'info>,

    /// Program accounnt
    /// CHECK: This is not dangerous
    #[account(address = crate::id())]
    pub program: AccountInfo<'info>,

    /// The system program.
    pub system_program: Program<'info, System>,
    pub rent_sysvar: Sysvar<'info, Rent>,

}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug, PartialEq)]
pub struct UpdateGlobalArgs {
    list: Vec<Pubkey>,
}

pub fn update_global(ctx: Context<UpdateGlobal>, args: UpdateGlobalArgs) -> Result<()> {
    let global = &mut ctx.accounts.global;
    let authority = &mut ctx.accounts.authority;

    // Calculate the new size required for the account
    let new_size = Global::get_size(global.whitelist_mint.len() + args.list.len());

    // Resize the account if necessary
    if new_size > global.to_account_info().data_len() {
        reallocate_bytes(
            (new_size - global.to_account_info().data_len()) as isize,
            global.to_account_info(),
            authority.to_account_info(),
            &ctx.accounts.rent_sysvar,
            &ctx.accounts.system_program,
        )?;
    }

    // Add the new Pubkeys to the whitelist_mint vector
    global.whitelist_mint.extend(args.list);
    Ok(())
}
