use anchor_lang::prelude::*;

#[error_code]
pub enum TournamentError {
    #[msg("The specified round does not exist")]
    InvalidRound,
    #[msg("The winner already exists for this round")]
    WinnerAlreadyExists,
    #[msg("The round has reached its limit for winners")]
    RoundWinnerLimitReached,
    #[msg("Tournament has not been closed")]
    TournamentNotClosed,
    #[msg("Tournament is full")]
    TournamentIsFull,
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
    #[msg("Only creator can pause the tournament")]
    OnlyCreatorCanPause,
    #[msg("No Joining Fee found")]
    NoJoiningFeeFound,
    #[msg("Tournament is not sponsored")]
    TournamentNotSponsored,
    #[msg("Invalid sponsor provided")]
    InvalidSponsorProvided,
    #[msg("Already refunded sponsor amount")]
    AlreadyRefundedSponsorAmount,
    #[msg("Sponsor Amount is not refunded")]
    SponsorAmountNotRefunded,
    #[msg("Players joining Fees is not refunded")]
    PlayersJoiningFeeNotRefunded,
    #[msg("Tournament is not paused")]
    TournamentNotPaused,
    #[msg("Opertaion overflowed")]
    OverFlow,
    #[msg("Wrong Creator provided")]
    WrongCreator,
    #[msg("Player not exist")]
    PlayerNotExist,
    #[msg("Mint Address Not White Listed")]
    MintNotWhiteListed,
    #[msg("Tournament is published")]
    TournamentPublished,
    #[msg("The signer is not authorized to perform this action.")]
    Unauthorized,
    #[msg("Invalid Program")]
    InvalidProgram,
    #[msg("No Mint Whitelist found")]
    NoMintWhitelistFound,
    #[msg("Creator must be Signer")]
    CreatorMustBeSigner,
    #[msg("Pubkey already exist")]
    PubkeyAlreadyExists,
    #[msg("Pubkey not found")]
    PubkeyNotFound,
}
