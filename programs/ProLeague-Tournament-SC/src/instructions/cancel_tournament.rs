use anchor_spl::{
    associated_token::AssociatedToken,
    token::{Mint, Token, TokenAccount, Transfer, CloseAccount},
};
use {
    crate::{constant::*, errors::TournamentError, state::*},
    anchor_lang::prelude::*,
};


#[derive(Accounts)]
pub struct PauseTournament<'info> {
    #[account(constraint = driver.key().eq(&DRIVER))]
    pub driver: Signer<'info>,
    
    #[account(mut)]
    pub tournament: Account<'info, Tournament>,

    #[account()]
    pub creator: Signer<'info>,

}

pub fn pause_tournament(
    ctx: Context<PauseTournament>
) -> Result<()> {
    let tournament = &mut ctx.accounts.tournament;
    let creator = &ctx.accounts.creator;
  
    if tournament.creator.key() != creator.key(){
        return Err(TournamentError::OnlyCreatorCanPause.into());
    }
 
    tournament.is_paused = true;
    
    Ok(())
}


#[derive(Accounts)]
pub struct RefundJoiningFees<'info> {
    #[account(mut, constraint = driver.key().eq(&DRIVER))]
    pub driver: Signer<'info>,

    /// CHECK: We are checking it in the body
    #[account()]
    pub player: AccountInfo<'info>,

    #[account(
        init_if_needed,
        payer = driver,
        associated_token::mint = mint,
        associated_token::authority = player,
    )]
    pub player_token_account: Account<'info, TokenAccount>,

    #[account(mut)]
    pub tournament: Account<'info, Tournament>,

    #[account(mut,
        constraint = tournament_token_account.mint == mint.key() && tournament_token_account.owner == tournament.key(),        
    )]
    pub tournament_token_account: Account<'info, TokenAccount>,
    #[account(address = tournament.mint @ TournamentError::InvalidMint)]
    pub mint: Account<'info, Mint>,

    pub associated_token_program: Program<'info, AssociatedToken>,
    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

pub fn refund_joining_fees(ctx: Context<RefundJoiningFees>) -> Result<()> {
    let tournament = &mut ctx.accounts.tournament;
    let player = &ctx.accounts.player;
    let tournament_token_account = &mut ctx.accounts.tournament_token_account;


    // Refunds belong to the cancellation flow only. On a live tournament this
    // would hand back an entry fee that is already promised as prize money and
    // silently drop the player from the bracket. Voluntary exit before the
    // brackets are announced is what leave_tournament is for.
    require!(tournament.is_paused, TournamentError::TournamentNotPaused);

    // Check joining fees
    if tournament.joining_fees <= 0 {
        return Err(TournamentError::NoJoiningFeeFound.into());
    }
    // Check the player is present in the  list
    if !tournament.players.contains(&player.key()) {
        return Err(TournamentError::PlayerNotFound.into());
    }

    // Only transfer the joining fee if it is greater than zero
    if tournament.joining_fees > 0 {
        let staker_seeds = &[
            TOURNAMENT_TAG.as_ref(),
            &tournament.tournament_id.as_ref(),
            &[tournament.bump],
        ];
        let cpi_signer = &[&staker_seeds[..]];
     
        let player_token_account = ctx.accounts.player_token_account.to_account_info().clone();
        let cpi_ctx = CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info().clone(),
            Transfer {
                from: tournament_token_account.to_account_info(),
                to: player_token_account.to_account_info(),
                authority: tournament.to_account_info(),
            },
            cpi_signer
        );
        // Entry fees carry no platform fee, so pending_fees is untouched. On a
        // cancellation the prize-pool fee is never collected: it returns to the
        // creator with the rest of the escrow in refund_creator_and_cancel.
        anchor_spl::token::transfer(cpi_ctx, tournament.joining_fees)?;
    }

   // Remove player from the list
    let index = tournament.players.iter().position(|x| *x == player.key()).unwrap();
    tournament.players.remove(index);

    Ok(())
}




#[derive(Accounts)]
pub struct RefundSponsor<'info> {
    #[account(mut, constraint = driver.key().eq(&DRIVER))]
    pub driver: Signer<'info>,
    
    /// CHECK: We are checking it in the body
    #[account()]
    pub sponsor: AccountInfo<'info>,

    #[account(
        init_if_needed,
        payer = driver,
        associated_token::mint = mint,
        associated_token::authority = sponsor,
    )]
    pub sponsor_token_account: Account<'info, TokenAccount>,

    #[account(mut)]
    pub tournament: Account<'info, Tournament>,

    #[account(mut,
        constraint = tournament_token_account.mint == mint.key() && tournament_token_account.owner == tournament.key(),        
    )]
    pub tournament_token_account: Account<'info, TokenAccount>,
    #[account(address = tournament.mint @ TournamentError::InvalidMint)]
    pub mint: Account<'info, Mint>,

    pub associated_token_program: Program<'info, AssociatedToken>,
    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

pub fn refund_sponsor(ctx: Context<RefundSponsor>) -> Result<()> {
    let tournament = &mut ctx.accounts.tournament;
    let sponsor = &ctx.accounts.sponsor;
    let tournament_token_account = &mut ctx.accounts.tournament_token_account;


    // Same as refund_joining_fees: only unwind a sponsorship as part of a
    // cancellation, never out from under a running tournament's prize pool.
    require!(tournament.is_paused, TournamentError::TournamentNotPaused);

    // Check sponsor
    if !tournament.is_sponsored {
        return Err(TournamentError::TournamentNotSponsored.into());
    }
    // Check already refunded sponsor amount
    if tournament.sponsor_amount <= 0 && tournament.is_sponsored   {
        return Err(TournamentError::AlreadyRefundedSponsorAmount.into());
    }
    // Check the sponsor is the sponsor one
    if tournament.sponsor.key() != sponsor.key() {
        return Err(TournamentError::InvalidSponsorProvided.into());
    }

    // Only transfer the sponsor amount if it is greater than zero
    if tournament.sponsor_amount > 0 {
        let staker_seeds = &[
            TOURNAMENT_TAG.as_ref(),
            &tournament.tournament_id.as_ref(),
            &[tournament.bump],
        ];
        let cpi_signer = &[&staker_seeds[..]];
     
        let sponsor_token_account = ctx.accounts.sponsor_token_account.to_account_info().clone();
        let cpi_ctx = CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info().clone(),
            Transfer {
                from: tournament_token_account.to_account_info(),
                to: sponsor_token_account.to_account_info(),
                authority: tournament.to_account_info(),
            },
        cpi_signer,
        );
        // Sponsorship carries no platform fee, so pending_fees is untouched.
        anchor_spl::token::transfer(cpi_ctx, tournament.sponsor_amount)?;
    }

   // Reset sponsor amount
   tournament.sponsor_amount = 0;

    Ok(())
}


#[derive(Accounts)]
pub struct RefundCreatorAndCancelTournament<'info> {
    #[account(mut, close = driver)]
    pub tournament: Account<'info, Tournament>,

    #[account(mut,
        constraint = tournament_token_account.mint == mint.key() && tournament_token_account.owner == tournament.key(),        
    )]
    pub tournament_token_account: Account<'info, TokenAccount>,


    #[account(mut,
        constraint = creator_token_account.mint == mint.key() && creator_token_account.owner == tournament.creator.key(),
     )]
     pub creator_token_account: Account<'info, TokenAccount>,


    #[account(constraint = driver.key().eq(&DRIVER))]
    pub driver: Signer<'info>,

    #[account(address = tournament.mint @ TournamentError::InvalidMint)]
    pub mint: Account<'info, Mint>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

pub fn refund_creator_and_cancel_tournament(ctx: Context<RefundCreatorAndCancelTournament>) -> Result<()> {
    let tournament = &mut ctx.accounts.tournament;
    let creator_token_account = &mut ctx.accounts.creator_token_account;
    let driver = &ctx.accounts.driver;
    let tournament_token_account = &mut ctx.accounts.tournament_token_account;
    
     // Check tournament should be paused
    if !tournament.is_paused   {
        return Err(TournamentError::TournamentNotPaused.into());
    }
     // Check sponsor_amount should be equal to zero
    if tournament.sponsor_amount != 0   {
        return Err(TournamentError::SponsorAmountNotRefunded.into());
    }
    // Check player array should be empty
    if tournament.joining_fees > 0 && tournament.players.len() != 0 {
        return Err(TournamentError::PlayersJoiningFeeNotRefunded.into());
    }
    // Send remaining tokens to the specific address
    let remaining_balance = tournament_token_account.amount;
    let tournament_seed = &[
        TOURNAMENT_TAG.as_ref(),
        &tournament.tournament_id.as_ref(),
        &[tournament.bump],
    ];
    let cpi_signer = &[&tournament_seed[..]];

    if remaining_balance > 0 {
       
        // Transfer the escrow balance from the tournament to the creator (vault)
        let cpi_ctx = CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info().clone(),
            Transfer {
                from: tournament_token_account.to_account_info(),
                to: creator_token_account.to_account_info(),
                authority: tournament.to_account_info(),
            },
            cpi_signer
        );
        anchor_spl::token::transfer(cpi_ctx, remaining_balance)?;

    }
    // Close Tournament Token Account
    let cpi_ctx = CpiContext::new_with_signer(
        ctx.accounts.token_program.to_account_info().clone(),
        CloseAccount {
            account:tournament_token_account.to_account_info(),
            destination: driver.to_account_info(),
            authority: tournament.to_account_info(), 
        },
        cpi_signer
    );
    anchor_spl::token::close_account(cpi_ctx)?;

    msg!("Refund to Creator and tournament close Successfully");

    Ok(())
}
