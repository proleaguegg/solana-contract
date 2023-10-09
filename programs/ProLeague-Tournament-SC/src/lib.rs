use anchor_lang::prelude::*;

pub mod constant;
pub mod errors;
pub mod states;
pub mod arguments;
pub mod accounts;


use crate::{constant::*, errors::*, states::*, use accounts::*, use arguments::*};

// This is your program's public key and it will update
// automatically when you build the project.
declare_id!("4gyGnQe3EH4QsAgubFJJ6sE4hGb1Ck45CYrbbXrQ7zsj");

#[program]
mod tournament {

    use super::*;
    pub fn initialize(ctx: Context<Initialize>, data: ArgumentInitialize) -> Result<()> {
        let tournament = &mut ctx.accounts.tournament;
        let vault = &mut ctx.accounts.vault; // Assuming the new account is named "vault"
        
        // Update tournament details
        tournament.creator = data.creator;
        tournament.escrow_balance = data.escrow_balance;
        tournament.tournament_id = data.tournament_id;
        tournament.joining_fees = 0;
        tournament.total_players = data.total_players;
        tournament.match_concluded = false;
        
        tournament.total_rounds = data.total_rounds;
         // Initialize rounds based on total players
        let num_rounds = (data.total_players as f64).log2() as u32;
        tournament.rounds = Vec::with_capacity(num_rounds as usize);
        for i in 0..num_rounds {
            tournament.rounds.push(Round {
                reverse_index: i as u8,
                winning_price: 0, // Or any default value you want
                winners_and_collected_status: HashMap::new(),
            });
        }

        msg!("Tournament Initialized with data: {:?}!", data);


        // Transfer the escrow balance from the creator to the new account (vault)
        let cpi_accounts = Transfer {
            from: ctx.accounts.authority.to_account_info().clone(),
            to: vault.to_account_info().clone(),
            authority: ctx.accounts.authority.to_account_info().clone(),
        };
        let cpi_program = ctx.accounts.system_program.to_account_info().clone();
        let cpi_ctx = CpiContext::new(cpi_program, cpi_accounts);
        anchor_lang::solana_program::token::transfer(cpi_ctx, data.escrow_balance)?;
    
        msg!("Changed data to: {:?}!", data);
        Ok(())
    }


    pub fn add_winner(
        ctx: Context<AddWinnerToRound>,
        winner: Pubkey,
        round_index: u8,
    ) -> Result<()> {
        let tournament = &mut ctx.accounts.tournament;

        // Ensure the round exists.
        if round_index as usize >= tournament.rounds.len() {
            return Err(TournamentError::InvalidRound.into());
        }

        let round = &mut tournament.rounds[round_index as usize];

        // Ensure the winner doesn't already exist.
        if round.winner_exists(&winner) {
            return Err(TournamentError::WinnerAlreadyExists.into());
        }

        // Ensure the round hasn't reached its winner limit.
        if !round.can_add_winner() {
            return Err(TournamentError::RoundWinnerLimitReached.into());
        }

        // Add the winner with their initial status.
        round.winners_and_collected_status.insert(
            winner,
            RoundWinners {
                won_next_round: false,
                claimed: false,
            },
        );

        Ok(())
    }


    pub fn conclude_match(ctx: Context<ConcludeMatch>) -> Result<()> {
        let tournament = &mut ctx.accounts.tournament;

        // Mark the match as concluded.
        tournament.match_concluded = true;

        msg!("Match has been marked as concluded.");
        
        Ok(())
    }


    pub fn claim_prize(ctx: Context<ClaimPrize>, winner: Pubkey) -> Result<()> {
        let tournament = &mut ctx.accounts.tournament;
        let round = &mut ctx.accounts.round; // Assuming you pass the specific round to claim from.
    
        // Validate if the match has been concluded
        if !tournament.match_concluded {
            return Err(TournamentError::MatchNotConcluded.into());
        }
    
        // Check if winner exists in this round
        if let Some(winner_status) = round.winners_and_collected_status.get(&winner) {
            // Validate if the winner hasn't claimed already
            if winner_status.claimed {
                return Err(TournamentError::AlreadyClaimed.into());
            }
    
            // Validate if the winner hasn't won the next round
            if winner_status.won_next_round {
                return Err(TournamentError::WonNextRound.into());
            }
    
            // Mark as claimed
            winner_status.claimed = true;
    
            // TODO: Transfer the prize amount to the winner. This will need more context, like which account holds the funds, etc.
            
            // Transfer the prize amount to the winner
            let cpi_accounts = Transfer {
                from: vault.to_account_info().clone(),
                to: ctx.accounts.authority.to_account_info().clone(),  // Assuming `authority` is the winner's account.
                authority: ctx.accounts.authority.to_account_info().clone(),
            };
            let cpi_program = ctx.accounts.token_program.to_account_info().clone();  // Assuming you have token_program in context
            let cpi_ctx = CpiContext::new(cpi_program, cpi_accounts);
            token::transfer(cpi_ctx, round.winning_price)?;
            
        
            msg!("Prize claimed successfully.");
            
        } else {
            return Err(TournamentError::WinnerNotFound.into());
        }
    
        Ok(())
    }
    
   
    
 
    
    

//     pub fn joining(ctx: Context<JoinTournament>, data: ArgumentJoining) -> Result<()> {
//         let tournament = &mut ctx.accounts.tournament;
//         // let mut participation: Vec<Participations> = tournament.participations.clone();

//         let fee = tournament.entry_fees;

//         let _transfer_authority: AccountInfo = ctx.accounts.authority.to_account_info().clone();

//         // Check if the team has already joined
//         for p in &tournament.participations {
//             if p.team_id == data.team_id {
//                 return Err(TournamentError::TeamAlreadyJoined.into());
//             }
//         }

//         anchor_lang::solana_program::program::invoke(
//             &anchor_lang::solana_program::system_instruction::transfer(
//                 ctx.accounts.authority.key,
//                 ctx.accounts.vault.key,
//                 fee,
//             ),
//             &[
//                 ctx.accounts.authority.to_account_info(),
//                 ctx.accounts.vault.to_account_info(),
//                 ctx.accounts.system_program.to_account_info(),
//             ],
//         )?;

//         // Add the new team
//         tournament.participations.push(Participations {
//             team_id: data.team_id,
//         });

//         // participation.push(Participations { team_id: (data.team_id) });

//         Ok(())
//     }

//     pub fn funds(ctx: Context<FundTournament>, data: ArgumentFund) -> Result<()> {
//         let fee = data.amount;

//         let _transfer_authority: AccountInfo = ctx.accounts.authority.to_account_info().clone();

//         anchor_lang::solana_program::program::invoke(
//             &anchor_lang::solana_program::system_instruction::transfer(
//                 ctx.accounts.authority.key,
//                 ctx.accounts.vault.key,
//                 fee,
//             ),
//             &[
//                 ctx.accounts.authority.to_account_info(),
//                 ctx.accounts.vault.to_account_info(),
//                 ctx.accounts.system_program.to_account_info(),
//             ],
//         )?;

//         Ok(())
//     }
}
