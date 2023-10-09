use anchor_lang::prelude::*;

#[error_code]
pub enum TournamentError {
    #[msg("Team Already Joined")]
    TeamAlreadyJoined,
    #[msg("Not allowed")]
    NotAllowed,
    #[msg("Math operation overflow")]
    MathOverflow,
    #[msg("Already marked")]
    AlreadyMarked,
    #[msg("The specified round does not exist.")]
    InvalidRound,
    #[msg("The winner already exists for this round.")]
    WinnerAlreadyExists,
    #[msg("The round has reached its limit for winners.")]
    RoundWinnerLimitReached,
    #[error("Match has not been concluded.")]
    MatchNotConcluded,
    #[error("Winner not found in this round.")]
    WinnerNotFound,
    #[error("Prize has already been claimed by the winner.")]
    AlreadyClaimed,
    #[error("Winner has won the next round and cannot claim this prize.")]
    WonNextRound,