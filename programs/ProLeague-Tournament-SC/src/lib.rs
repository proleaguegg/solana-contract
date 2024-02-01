use anchor_lang::prelude::*;
// use std::collections::HashMap;

// pub mod accountsInfo;
// pub mod arguments;
pub mod constant;
pub mod errors;
pub mod instructions;
pub mod state;

// use crate::{accountsInfo::*, arguments::*, errors::*, state::*};
use instructions::*;

// This is your program's public key and it will update
// automatically when you build the project.
declare_id!("matchNmUczmPKteQb9BJ8gRgafaQpDh2oDZJGuLsHfR");

#[program]
mod tournament {

    use super::*;
    pub fn initialize(ctx: Context<Initialize>, args: ArgumentInitialize) -> Result<()> {
        instructions::initialize(ctx, args)
    }

    pub fn join_tournament(ctx: Context<JoinTournament>) -> Result<()> {
        instructions::join_tournament(ctx)
    }

    pub fn add_winner(ctx: Context<AddWinnerToRound>, args: AddWinnerToRoundArgs) -> Result<()> {
        instructions::add_winner(ctx, args)
    }

    pub fn mark_winner_won_next_round(
        ctx: Context<MarkWinnerWonNextRound>,
        args: MarkWinnerWonNextRoundArgs,
    ) -> Result<()> {
        instructions::mark_winner_won_next_round(ctx, args)
    }

    pub fn conclude_tournament(ctx: Context<ConcludeTournament>) -> Result<()> {
        instructions::conclude_tournament(ctx)
    }

    pub fn send_prize(ctx: Context<SendPrize>, args: SendPrizeArgs) -> Result<()> {
        instructions::send_prize(ctx, args)
    }

    pub fn publish_tournament(
        ctx: Context<PublishTournament>,
        args: ArgumentPublishTournament,
    ) -> Result<()> {
        instructions::publish_tournament(ctx, args)
    }

    pub fn sponsor_tournament(
        ctx: Context<SponsorTournament>,
        args: ArgumentSponsorTournament,
    ) -> Result<()> {
        instructions::sponsor_tournament(ctx, args)
    }

    pub fn pause_tournament(
        ctx: Context<PauseTournament>,
    ) -> Result<()> {
        instructions::pause_tournament(ctx)
    }

    pub fn refund_joining_fees(
        ctx: Context<RefundJoiningFees>,
    ) -> Result<()> {
        instructions::refund_joining_fees(ctx)
    }

    pub fn refund_sponsor(
        ctx: Context<RefundSponsor>,
    ) -> Result<()> {
        instructions::refund_sponsor(ctx)
    }
    
    pub fn refund_creator_and_close_tournament(
        ctx: Context<RefundCreatorAndCloseTournament>,
    ) -> Result<()> {
        instructions::refund_creator_and_close_tournament(ctx)
    }
}
