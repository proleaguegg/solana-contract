use anchor_lang::prelude::*;

pub mod constant;
pub mod errors;
pub mod instructions;
pub mod state;
pub mod utils;

use instructions::*;

// This is your program's public key and it will update
// automatically when you build the project.
declare_id!("matchNmUczmPKteQb9BJ8gRgafaQpDh2oDZJGuLsHfR");

#[program]
mod tournament {

    use utils::assert_program_authority;

    use super::*;
    pub fn initialize(ctx: Context<Initialize>, args: ArgumentInitialize) -> Result<()> {
        instructions::initialize(ctx, args)
    }

    pub fn sponsor_tournament(
        ctx: Context<SponsorTournament>,
        args: ArgumentSponsorTournament,
    ) -> Result<()> {
        instructions::sponsor_tournament(ctx, args)
    }

    pub fn join_tournament(ctx: Context<JoinTournament>) -> Result<()> {
        instructions::join_tournament(ctx)
    }
    pub fn leave_tournament(ctx: Context<LeaveTournament>) -> Result<()> {
        instructions::leave_tournament(ctx)
    }

    pub fn publish_tournament(
        ctx: Context<PublishTournament>,
        args: ArgumentPublishTournament,
    ) -> Result<()> {
        instructions::publish_tournament(ctx, args)
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

    pub fn send_prize(ctx: Context<SendPrize>, args: SendPrizeArgs) -> Result<()> {
        instructions::send_prize(ctx, args)
    }

    pub fn close_tournament(ctx: Context<CloseTournament>) -> Result<()> {
        instructions::close_tournament(ctx)
    }

    pub fn pause_tournament(ctx: Context<PauseTournament>) -> Result<()> {
        instructions::pause_tournament(ctx)
    }

    pub fn refund_joining_fees(ctx: Context<RefundJoiningFees>) -> Result<()> {
        instructions::refund_joining_fees(ctx)
    }

    pub fn refund_sponsor(ctx: Context<RefundSponsor>) -> Result<()> {
        instructions::refund_sponsor(ctx)
    }

    pub fn refund_creator_and_cancel_tournament(
        ctx: Context<RefundCreatorAndCancelTournament>,
    ) -> Result<()> {
        instructions::refund_creator_and_cancel_tournament(ctx)
    }

    pub fn destroy_tournament(
        ctx: Context<DestroyTournament>,
        args: DestroyTournamentArgs,
    ) -> Result<()> {
        instructions::destroy_tournament(ctx, args)
    }

    pub fn reallocate_tournament(ctx: Context<ReallocateTournament>) -> Result<()> {
        instructions::reallocate_tournament(ctx)
    }

    pub fn transpose_tournament_creator(
        ctx: Context<TransposeTournamentCreator>,
        args: ArgumentTransposeTournamentCreator,
    ) -> Result<()> {
        instructions::transpose_tournament_creator(ctx, args)
    }

    pub fn transpose_tournament_player(
        ctx: Context<TransposeTournamentPlayer>,
        args: ArgumentTransposeTournamentPlayer,
    ) -> Result<()> {
        instructions::transpose_tournament_player(ctx, args)
    }

    /// This function initializes the public information for the Mint.
    pub fn init_global(ctx: Context<InitGlobal>, args: InitGlobalArgs) -> Result<()> {
        assert_program_authority(
            ctx.accounts.program.to_account_info(),
            ctx.accounts.program_data.to_account_info(),
            ctx.accounts.authority.key,
        )?;
        instructions::init_global(ctx, args)
    }

    pub fn update_global(ctx: Context<UpdateGlobal>, args: UpdateGlobalArgs) -> Result<()> {
        assert_program_authority(
            ctx.accounts.program.to_account_info(),
            ctx.accounts.program_data.to_account_info(),
            ctx.accounts.authority.key,
        )?;
        instructions::update_global(ctx, args)
    }

    pub fn announce_tournament(ctx: Context<AnnounceTournament>) -> Result<()> {
        instructions::announce_tournament(ctx)
    }

    // ===== Leaderboard =====

    pub fn initialize_leaderboard(
        ctx: Context<InitializeLeaderboard>,
        args: InitializeLeaderboardArgs,
    ) -> Result<()> {
        instructions::initialize_leaderboard(ctx, args)
    }

    pub fn publish_leaderboard(ctx: Context<PublishLeaderboard>) -> Result<()> {
        instructions::publish_leaderboard(ctx)
    }

    pub fn cancel_leaderboard(ctx: Context<CancelLeaderboard>) -> Result<()> {
        instructions::cancel_leaderboard(ctx)
    }

    pub fn join_leaderboard(ctx: Context<JoinLeaderboard>) -> Result<()> {
        instructions::join_leaderboard(ctx)
    }

    pub fn leave_leaderboard(ctx: Context<LeaveLeaderboard>) -> Result<()> {
        instructions::leave_leaderboard(ctx)
    }

    pub fn deposit_sponsorship(
        ctx: Context<DepositSponsorship>,
        args: DepositSponsorshipArgs,
    ) -> Result<()> {
        instructions::deposit_sponsorship(ctx, args)
    }

    pub fn refund_leaderboard_sponsor(ctx: Context<RefundLeaderboardSponsor>) -> Result<()> {
        instructions::refund_leaderboard_sponsor(ctx)
    }

    pub fn conclude_leaderboard(ctx: Context<ConcludeLeaderboard>) -> Result<()> {
        instructions::conclude_leaderboard(ctx)
    }

    pub fn send_prize_leaderboard(
        ctx: Context<SendLeaderboardPrize>,
        args: SendLeaderboardPrizeArgs,
    ) -> Result<()> {
        instructions::send_prize_leaderboard(ctx, args)
    }

    pub fn refund_leaderboard_player(ctx: Context<RefundLeaderboardPlayer>) -> Result<()> {
        instructions::refund_leaderboard_player(ctx)
    }

    pub fn close_leaderboard(ctx: Context<CloseLeaderboard>) -> Result<()> {
        instructions::close_leaderboard(ctx)
    }
}
