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
}