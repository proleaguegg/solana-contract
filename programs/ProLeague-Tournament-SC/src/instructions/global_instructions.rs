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
     global.bump = ctx.bumps.global;
    global.whitelist_mint = args.list;
    Ok(())
}

#[derive(Accounts)]
#[instruction(args: UpdateGlobalArgs)]
pub struct UpdateGlobal<'info> {
    /// Public info account
   #[account(mut,seeds = [GLOBAL_TAG.as_ref(), crate::id().as_ref()],bump)]
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
pub enum  UpdateGlobalArgs {
    Add(Pubkey),
    Remove(Pubkey),
}

pub fn update_global(ctx: Context<UpdateGlobal>, args: UpdateGlobalArgs) -> Result<()> {
    let global = &mut ctx.accounts.global;
    let authority = &mut ctx.accounts.authority;
    let pre_size = global.whitelist_mint.len() as isize;

    match args {
        UpdateGlobalArgs::Add(pubkey) => {
            // Add the new Pubkey to the whitelist_mint vector
            global.whitelist_mint.push(pubkey);
        },
        UpdateGlobalArgs::Remove(pubkey) => {
            global.whitelist_mint.retain(|&x| x != pubkey);

        },
    }
    let new_size = global.whitelist_mint.len() as isize;

    if  pre_size != new_size {
        reallocate_bytes(
            new_size - pre_size * 32, // Pubkey size
            global.to_account_info(),
            authority.to_account_info(),
            &ctx.accounts.rent_sysvar,
            &ctx.accounts.system_program,
        )?;
    }

    Ok(())
}
