use anchor_lang::prelude::*;

pub mod constant;
pub mod states;
pub mod errors;

use crate::{constant::*, states::*, errors::*};

// This is your program's public key and it will update
// automatically when you build the project.
declare_id!("4gyGnQe3EH4QsAgubFJJ6sE4hGb1Ck45CYrbbXrQ7zsj");

#[program]
mod tournament {

    use super::*;
    pub fn initialize(ctx: Context<Initialize>, data: ArguementsInitialize) -> Result<()> {
        let tournament = &mut ctx.accounts.tournament;
        tournament.creator = data.creator;
        tournament.tournament_id = data.tournament_id;
        tournament.entry_fees = data.entry_fees;
        tournament.is_closed = false;

        msg!("Changed data to: {:?}!", data); // Message will show up in the tx logs
        Ok(())
    }

    pub fn joining(ctx: Context<JoinTournament>, data: ArguementsJoining) -> Result<()> {
        let tournament = &mut ctx.accounts.tournament;
        // let mut participation: Vec<Participations> = tournament.participations.clone();

        let fee = tournament.entry_fees;

        let _transfer_authority: AccountInfo = ctx.accounts.authority.to_account_info().clone();

        // Check if the team has already joined
        for p in &tournament.participations {
            if p.team_id == data.team_id {
                return Err(TournamentError::TeamAlreadyJoined.into());
            }
        }

        anchor_lang::solana_program::program::invoke(
            &anchor_lang::solana_program::system_instruction::transfer(ctx.accounts.authority.key, ctx.accounts.vault.key, fee),
            &[ctx.accounts.authority.to_account_info(), ctx.accounts.vault.to_account_info(), ctx.accounts.system_program.to_account_info()],
        )?;

         // Add the new team
        tournament.participations.push(Participations {
            team_id: data.team_id,
        });

        // participation.push(Participations { team_id: (data.team_id) });

        Ok(())
    }

    pub fn funds(ctx: Context<FundTournament>, data: ArguementsFund) -> Result<()> {
        let fee = data.amount;

        let _transfer_authority: AccountInfo = ctx.accounts.authority.to_account_info().clone();


        anchor_lang::solana_program::program::invoke(
            &anchor_lang::solana_program::system_instruction::transfer(ctx.accounts.authority.key, ctx.accounts.vault.key, fee),
            &[ctx.accounts.authority.to_account_info(), ctx.accounts.vault.to_account_info(), ctx.accounts.system_program.to_account_info()],
        )?;

        Ok(())
    }

    }

#[derive(Accounts)]
#[instruction(data: ArguementsInitialize)]
pub struct Initialize<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,

    #[account(init, seeds = [TOURNAMENT_TAG.as_ref(), &data.tournament_id.to_le_bytes()[..]], bump, payer = authority, space = 8 + std::mem::size_of::<Tournament>())]
    pub tournament: Account<'info, Tournament>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct JoinTournament<'info>{
    #[account(mut)]
    pub authority: Signer<'info>,

    #[account(mut, seeds = [TOURNAMENT_TAG.as_ref(), &tournament.tournament_id.to_le_bytes()[..]], bump)]
    pub tournament: Account<'info, Tournament>,

     /// CHECK: This is not dangerous because we don't read or write from this account   
    #[account(mut, seeds = [VAULT_TAG.as_ref(), tournament.key().as_ref()], bump)]
    pub vault: AccountInfo<'info>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct FundTournament<'info>{
    #[account(mut)]
    pub authority: Signer<'info>,

    #[account(mut, seeds = [TOURNAMENT_TAG.as_ref(), &tournament.tournament_id.to_le_bytes()[..]], bump)]
    pub tournament: Account<'info, Tournament>,

     /// CHECK: This is not dangerous because we don't read or write from this account   
    #[account(mut, seeds = [VAULT_TAG.as_ref(), tournament.key().as_ref()], bump)]
    pub vault: AccountInfo<'info>,

    pub system_program: Program<'info, System>,
}


#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug)]
pub struct ArguementsInitialize {
    pub entry_fees: u64,
    pub tournament_id: u64,
    pub creator: Pubkey,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug)]
pub struct ArguementsJoining {
   pub team_id: u64
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug)]
pub struct ArguementsFund {
   pub amount: u64
}


