use anchor_spl::{
    associated_token::AssociatedToken,
    token::{Mint, Token, TokenAccount, Transfer},
};

use {
    crate::{constant::*, errors::TournamentError, state::*},
    anchor_lang::prelude::*,
};

#[derive(Accounts)]
pub struct JoinTournament<'info> {
    #[account(mut, constraint = driver.key().eq(&DRIVER))]
    pub driver: Signer<'info>,

    /// CHECK: We are checking it in the body
    #[account(constraint = player.key().eq(&player_info.key()) )]
    pub player: Option<Signer<'info>>,

    /// CHECK: We are checking it in the body
    #[account()]
    pub player_info: AccountInfo<'info>,

    #[account(
        init_if_needed,
        payer = driver,
        associated_token::mint = mint,
        associated_token::authority = player,
    )]
    pub player_token_account: Option<Account<'info, TokenAccount>>,

    #[account(mut)]
    pub tournament: Account<'info, Tournament>,

    #[account(mut)]
    pub tournament_token_account: Account<'info, TokenAccount>,
    #[account()]
    pub mint: Account<'info, Mint>,

    pub associated_token_program: Program<'info, AssociatedToken>,
    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

pub fn join_tournament(ctx: Context<JoinTournament>) -> Result<()> {
    let tournament = &mut ctx.accounts.tournament;
    let player = &ctx.accounts.player_info;
    let tournament_token_account = &mut ctx.accounts.tournament_token_account;

    // // Check if the tournament is already closed
    // if tournament.tournament_closed {
    //     return Err(TournamentError::TournamentNotClosed.into());
    // }
    if tournament.players.len() >= tournament.total_players as usize {
        return Err(TournamentError::TournamentIsFull.into());
    }

    // Check if the player has already joined
    if tournament.players.contains(&player.key()) {
        return Err(TournamentError::PlayerAlreadyJoined.into());
    }

    // Only transfer the joining fee if it is greater than zero
    if tournament.joining_fees > 0 {
        let player_token_account = ctx.accounts.player_token_account.as_ref().unwrap();
        // Ensure that the player is a signer if joining fees are required
        require!(player.is_signer, TournamentError::PlayerMustBeSigner);

        let cpi_ctx = CpiContext::new(
            ctx.accounts.token_program.to_account_info().clone(),
            Transfer {
                from: player_token_account.to_account_info(),
                to: tournament_token_account.to_account_info().clone(),
                authority: player.to_account_info().clone(),
            },
        );
        anchor_spl::token::transfer(cpi_ctx, tournament.joining_fees)?;
    }

    // Add the player to the tournament's list of players
    tournament.players.push(player.key());

    msg!("Player {:?} has joined the tournament!", player.key());

    Ok(())
}

#[derive(Accounts)]
pub struct LeaveTournament<'info> {
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
    #[account()]
    pub mint: Account<'info, Mint>,

    pub associated_token_program: Program<'info, AssociatedToken>,
    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

pub fn leave_tournament(ctx: Context<LeaveTournament>) -> Result<()> {
    let tournament = &mut ctx.accounts.tournament;
    let player = &ctx.accounts.player;
    let tournament_token_account = &mut ctx.accounts.tournament_token_account;

    // Check if the bracket has been announced throw error
    if tournament.is_announced {
        return Err(TournamentError::BracketsIsAnnounced.into());
    }
    // Check the player exist in the players
    if !tournament.players.contains(&player.key()) {
        return Err(TournamentError::PlayerNotExist.into());
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
        anchor_spl::token::transfer(cpi_ctx, tournament.joining_fees)?;
    }

    // Remove player from the list
    let index = tournament
        .players
        .iter()
        .position(|x| *x == player.key())
        .unwrap();
    tournament.players.remove(index);

    msg!(
        "Player {:?} has been removed from the tournament!",
        player.key()
    );

    Ok(())
}
