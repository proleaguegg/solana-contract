use anchor_lang::prelude::*;

#[error_code]
pub enum TournamentError {
    #[msg("The specified round does not exist")]
    InvalidRound,
    #[msg("The winner already exists for this round")]
    WinnerAlreadyExists,
    #[msg("The round has reached its limit for winners")]
    RoundWinnerLimitReached,
    #[msg("Tournament has not been concluded")]
    TournamentNotConcluded,
    #[msg("Winner not found in this round")]
    WinnerNotFound,
    #[msg("Prize has already been claimed by the winner")]
    AlreadyClaimed,
    #[msg("Winner has won the next round and cannot claim this prize")]
    WonNextRound,
    #[msg("Player Already joined")]
    PlayerAlreadyJoined,
    #[msg("Winner not found in players list")]
    PlayerNotFound,
    #[msg("Exceeding Escrow Balance")]
    ExceedingEscrowBalance,
    #[msg("Player must be Signer")]
    PlayerMustBeSigner,
    #[msg("Tournament is Closed")]
    TournamentIsClosed,
    #[msg("Tournament is already sponsored")]
    TournamentAlreadySponsored,
    #[msg("Prize not Claimed")]
    PrizeNotClaimed,
    #[msg("Expected Winner Length Error")]
    ExpectedWinnerLength,
}
