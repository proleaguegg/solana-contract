use anchor_lang::prelude::*;

#[derive(Accounts)]
#[instruction(data: ArgumentInitialize)]
pub struct Initialize<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,

    #[account(init, seeds = [TOURNAMENT_TAG.as_ref(), &data.tournament_id.to_le_bytes()[..]], bump, payer = authority, space = 8 + std::mem::size_of::<Tournament>())]
    pub tournament: Account<'info, Tournament>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct AddWinnerToRound<'info> {
    #[account(mut)]
    pub tournament: Account<'info, Tournament>,
    pub authority: Signer<'info>,
}


#[derive(Accounts)]
pub struct ConcludeMatch<'info> {
    #[account(mut)]
    pub tournament: Account<'info, Tournament>,
    pub authority: Signer<'info>, // Assuming the authority (like an admin or match referee) is required to conclude the match.
}

#[derive(Accounts)]
pub struct ClaimPrize<'info> {
    #[account(mut)]
    pub tournament: Account<'info, Tournament>,
    #[account(mut)]
    pub round: Account<'info, Round>,
    #[account(mut)]
    pub vault: AccountInfo<'info>, // Vault account that holds the funds
    pub authority: Signer<'info>, // The winner's account
    pub token_program: Program<'info>, // Token program for the transfer instruction
}

// #[derive(Accounts)]
// pub struct JoinTournament<'info> {
//     #[account(mut)]
//     pub authority: Signer<'info>,

//     #[account(mut, seeds = [TOURNAMENT_TAG.as_ref(), &tournament.tournament_id.to_le_bytes()[..]], bump)]
//     pub tournament: Account<'info, Tournament>,

//     /// CHECK: This is not dangerous because we don't read or write from this account   
//     #[account(mut, seeds = [VAULT_TAG.as_ref(), tournament.key().as_ref()], bump)]
//     pub vault: AccountInfo<'info>,

//     pub system_program: Program<'info, System>,
// }

// #[derive(Accounts)]
// pub struct FundTournament<'info> {
//     #[account(mut)]
//     pub authority: Signer<'info>,

//     #[account(mut, seeds = [TOURNAMENT_TAG.as_ref(), &tournament.tournament_id.to_le_bytes()[..]], bump)]
//     pub tournament: Account<'info, Tournament>,

//     /// CHECK: This is not dangerous because we don't read or write from this account   
//     #[account(mut, seeds = [VAULT_TAG.as_ref(), tournament.key().as_ref()], bump)]
//     pub vault: AccountInfo<'info>,

//     pub system_program: Program<'info, System>,
// }
