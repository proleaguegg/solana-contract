use {
    crate::{constant::*, errors::TournamentError, state::*},
    anchor_lang::prelude::*,
};

#[derive(Accounts)]
pub struct TransposeTournamentCreator<'info> {
    #[account(constraint = driver.key().eq(&DRIVER))]
    pub driver: Signer<'info>,

    /// CHECK: We are checking it in the body
    #[account()]
    pub creator: AccountInfo<'info>,

    #[account(mut)]
    pub tournament: Account<'info, Tournament>,
}
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug)]
pub struct ArgumentTransposeTournamentCreator {
    pub new_creator: Pubkey,
}

pub fn transpose_tournament_creator(
    ctx: Context<TransposeTournamentCreator>,
    data: ArgumentTransposeTournamentCreator,
) -> Result<()> {
    let tournament = &mut ctx.accounts.tournament;
    let creator = &ctx.accounts.creator;
    let new_creator = data.new_creator;

    if tournament.creator.key() != creator.key() {
        return Err(TournamentError::WrongCreator.into());
    }

    msg!(
        "Tournament ceator changed from to: {:?}! {:?}!",
        tournament.creator.key(),
        new_creator
    );
    tournament.creator = new_creator;

    Ok(())
}

#[derive(Accounts)]
pub struct TransposeTournamentPlayer<'info> {
    #[account(constraint = driver.key().eq(&DRIVER))]
    pub driver: Signer<'info>,

    /// CHECK: We are checking it in the body
    #[account()]
    pub player: AccountInfo<'info>,

    #[account(mut)]
    pub tournament: Account<'info, Tournament>,
}
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug)]
pub struct ArgumentTransposeTournamentPlayer {
    pub new_player: Pubkey,
}

pub fn transpose_tournament_player(
    ctx: Context<TransposeTournamentPlayer>,
    data: ArgumentTransposeTournamentPlayer,
) -> Result<()> {
    let tournament = &mut ctx.accounts.tournament;
    let player = &ctx.accounts.player;
    let new_player = data.new_player;

    // Check the player exist or not
    if !tournament.players.contains(&player.key()) {
        return Err(TournamentError::PlayerNotExist.into());
    }

    let index: usize = tournament
        .players
        .iter()
        .position(|x| *x == player.key())
        .unwrap();

    msg!(
        "Join player modified from to: {:?}! {:?}!",
        player.key(),
        new_player
    );

    tournament.players[index as usize] = new_player;

    Ok(())
}
