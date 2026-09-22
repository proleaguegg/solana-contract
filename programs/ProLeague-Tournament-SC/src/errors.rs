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
    #[msg("Brackets has been announced. You Can't leave tournament")]
    BracketsIsAnnounced,
    #[msg("Platform fee exceeds maximum allowed")]
    InvalidFee,
    #[msg("Treasury account does not match program treasury")]
    InvalidTreasury,
    #[msg("Tournament is not published")]
    TournamentNotPublished,
    #[msg("Total players must be a power of two and at least 2")]
    InvalidPlayerCount,
    #[msg("Tournament sponsorship window is closed")]
    SponsorshipClosed,
    #[msg("Tournament is paused for cancellation")]
    TournamentIsPaused,
    #[msg("Creator has insufficient funds to cover the prize pool and platform fee")]
    InsufficientCreatorFunds,
    #[msg("A tournament that charges an entry fee must award a prize pool")]
    PrizePoolRequired,
}

#[error_code]
pub enum LeaderboardError {
    // ----- state / timing -----
    #[msg("Leaderboard is not in Open state")]
    LeaderboardNotOpen,
    #[msg("Leaderboard is not in Concluded state")]
    LeaderboardNotConcluded,
    #[msg("Leaderboard is not in Cancelled state")]
    LeaderboardNotCancelled,
    #[msg("Leaderboard already published")]
    LeaderboardAlreadyPublished,
    #[msg("Leaderboard already cancelled")]
    LeaderboardAlreadyCancelled,
    #[msg("Leaderboard already concluded")]
    LeaderboardAlreadyConcluded,
    #[msg("Leaderboard registration window has closed")]
    RegistrationClosed,
    #[msg("Leaderboard sponsorship window has closed")]
    SponsorshipClosed,
    #[msg("Leaderboard end time has not been reached")]
    LeaderboardNotEnded,
    #[msg("Start time must be in the future")]
    StartTimeInPast,
    #[msg("Invalid time window")]
    InvalidTimeWindow,
    #[msg("Sponsor cutoff is invalid")]
    SponsorCutoffInvalid,

    // ----- capacity / config -----
    #[msg("Participant limit reached")]
    ParticipantLimitReached,
    #[msg("Below minimum participants")]
    BelowMinParticipants,
    #[msg("Too many payout slots")]
    PayoutSlotsTooMany,
    #[msg("Payout bps must sum to 10000")]
    PayoutSumMismatch,
    #[msg("min_participants must be > 0 and <= max_participants")]
    InvalidMinMaxParticipants,
    #[msg("Platform fee out of range")]
    InvalidFee,
    #[msg("Leaderboard id too long")]
    LeaderboardIdTooLong,

    // ----- idempotency markers (workers string-match these) -----
    // NOTE: duplicate refunds are NOT signalled here. refund_leaderboard_player /
    // refund_leaderboard_sponsor close the Participant/Sponsor PDA on success, so a
    // repeat call fails with Anchor's AccountNotInitialized (error 3012) — off-chain
    // workers treat 3012 on those two instructions as "already refunded".
    #[msg("Winner already paid for this slot")]
    WinnerAlreadyPaid,
    #[msg("Player already joined")]
    PlayerAlreadyJoined,
    #[msg("Slot index out of order")]
    SlotIndexOutOfOrder,

    // ----- lookup -----
    #[msg("Player is not enrolled")]
    PlayerNotEnrolled,
    #[msg("Sponsor not found")]
    SponsorNotFound,
    #[msg("Winner is not enrolled")]
    WinnerNotEnrolled,

    // ----- safety / auth -----
    #[msg("Mint does not match leaderboard mint")]
    InvalidMint,
    #[msg("Invalid treasury account")]
    InvalidTreasury,
    #[msg("Unauthorized")]
    Unauthorized,
    #[msg("Arithmetic overflow")]
    OverFlow,
    #[msg("Payouts not complete")]
    PayoutsNotComplete,
    #[msg("Refunds not complete")]
    RefundsNotComplete,
}
