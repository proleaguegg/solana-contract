use crate::errors::TournamentError;
use anchor_lang::prelude::*;
use anchor_lang::prelude::{AccountInfo, Program, Rent, Result, System, Sysvar, ToAccountInfo};

#[track_caller]
#[inline(always)]
pub const fn add_signed(a: usize, b: isize) -> usize {
    match b {
        x if x < 0 => a - x.wrapping_abs() as usize,
        x => a + x as usize,
    }
}

pub fn reallocate_bytes<'info>(
    diff_len: isize,
    account_info: AccountInfo<'info>,
    payer_info: AccountInfo<'info>,
    rent_sysvar: &Sysvar<'info, Rent>,
    system_program: &Program<'info, System>,
) -> Result<()> {
    let curr_len = account_info.data_len();
    let new_len = add_signed(curr_len, diff_len);
    let curr_rent = rent_sysvar.minimum_balance(curr_len);
    let new_rent = rent_sysvar.minimum_balance(new_len);
    let rent_diff: isize = isize::try_from(new_rent).unwrap() - isize::try_from(curr_rent).unwrap();

    let account_info_borrow = account_info.clone();
    if rent_diff > 0 {
        solana_program::program::invoke(
            &solana_program::system_instruction::transfer(
                payer_info.key,
                account_info_borrow.key,
                u64::try_from(rent_diff).unwrap(),
            ),
            &[
                payer_info,
                account_info_borrow,
                system_program.to_account_info(),
            ],
        )?;
    } else if rent_diff < 0 {
        let parsed_rent_diff = u64::try_from(rent_diff * -1).unwrap();

        **payer_info.lamports.borrow_mut() = payer_info
            .lamports()
            .checked_add(parsed_rent_diff)
            .ok_or(TournamentError::OverFlow)?;

        **account_info.lamports.borrow_mut() = account_info
            .lamports()
            .checked_sub(parsed_rent_diff)
            .ok_or(TournamentError::OverFlow)?;
    } else {
        return Ok(());
    }
    if diff_len.wrapping_abs() as usize > solana_program::entrypoint::MAX_PERMITTED_DATA_INCREASE {
        let mut updated_s = account_info.data_len().clone();
        while updated_s < new_len {
            updated_s += solana_program::entrypoint::MAX_PERMITTED_DATA_INCREASE;
            if updated_s > new_len {
                updated_s = new_len;
            }
            account_info.realloc(updated_s, false).unwrap()
        }
        while updated_s > new_len {
            updated_s -= solana_program::entrypoint::MAX_PERMITTED_DATA_INCREASE;
            if updated_s < new_len {
                updated_s = new_len;
            }
            account_info.realloc(updated_s, false).unwrap()
        }
        Ok(())
    } else {
        account_info
            .realloc(usize::try_from(new_len).unwrap(), false)
            .map_err(Into::into)
    }
}

/// Splits a gross amount into (fee, net) at `fee_bps` / `total_bps`. Shared by
/// tournament and leaderboard fee math so both stay in lockstep. `None` on overflow.
pub fn compute_fee_bps(gross: u64, fee_bps: u16, total_bps: u16) -> Option<u64> {
    (gross as u128)
        .checked_mul(fee_bps as u128)
        .and_then(|v| v.checked_div(total_bps as u128))
        .and_then(|v| u64::try_from(v).ok())
}

pub fn compute_net_bps(gross: u64, fee_bps: u16, total_bps: u16) -> Option<u64> {
    let fee = compute_fee_bps(gross, fee_bps, total_bps)?;
    gross.checked_sub(fee)
}

#[cfg(test)]
mod fee_math_tests {
    use super::*;

    const TOTAL: u16 = 10_000;

    #[test]
    fn fee_and_net_always_sum_to_gross() {
        // No dust may be created or lost: what the player pays must equal what
        // the prize pool gets plus what the treasury is owed.
        for gross in [0u64, 1, 3, 7, 10, 999, 10_000_000_000, u64::MAX / 4] {
            for bps in [0u16, 1, 250, 2_000, 3_000] {
                let fee = compute_fee_bps(gross, bps, TOTAL).unwrap();
                let net = compute_net_bps(gross, bps, TOTAL).unwrap();
                assert_eq!(fee + net, gross, "gross={gross} bps={bps}");
            }
        }
    }

    #[test]
    fn zero_fee_takes_nothing() {
        assert_eq!(compute_fee_bps(1_000, 0, TOTAL), Some(0));
        assert_eq!(compute_net_bps(1_000, 0, TOTAL), Some(1_000));
    }

    #[test]
    fn twenty_percent_of_ten_is_two() {
        assert_eq!(compute_fee_bps(10, 2_000, TOTAL), Some(2));
        assert_eq!(compute_net_bps(10, 2_000, TOTAL), Some(8));
    }

    #[test]
    fn rounds_down_never_over_charges() {
        // 3 * 20% = 0.6 -> floors to 0, so the player never loses a whole unit.
        assert_eq!(compute_fee_bps(3, 2_000, TOTAL), Some(0));
    }

    #[test]
    fn join_then_refund_returns_to_zero() {
        // join_tournament books this, leave_tournament / refund_joining_fees
        // un-books it — the pair must cancel exactly or pending_fees drifts.
        let entry = 10_000_000u64;
        let bps = 2_000u16;
        let mut pending = 0u64;
        for _ in 0..8 {
            pending += compute_fee_bps(entry, bps, TOTAL).unwrap();
        }
        for _ in 0..8 {
            pending = pending
                .checked_sub(compute_fee_bps(entry, bps, TOTAL).unwrap())
                .unwrap();
        }
        assert_eq!(pending, 0);
    }

    #[test]
    fn overflow_is_none_not_panic() {
        assert_eq!(compute_fee_bps(u64::MAX, 3_000, 0), None);
    }
}

pub fn assert_program_authority(
    program: AccountInfo,
    program_data: AccountInfo,
    signer_address: &Pubkey,
) -> Result<()> {
    let program = UpgradeableLoaderState::try_deserialize(&mut program.data.borrow().as_ref())?;
    match program {
        UpgradeableLoaderState::Program {
            programdata_address,
        } => {
            if programdata_address.eq(program_data.key) {
                let programdata = UpgradeableLoaderState::try_deserialize(
                    &mut program_data.data.borrow().as_ref(),
                )?;
                match programdata {
                    UpgradeableLoaderState::ProgramData {
                        slot: _,
                        upgrade_authority_address,
                    } => {
                        if upgrade_authority_address.is_none()
                            || upgrade_authority_address.unwrap().ne(signer_address)
                        {
                            return Err(TournamentError::Unauthorized.into());
                        }
                    }
                    _ => return Err(TournamentError::InvalidProgram.into()),
                }
            } else {
                return Err(TournamentError::InvalidProgram.into());
            }
        }
        _ => return Err(TournamentError::InvalidProgram.into()),
    }
    return Ok(());
}
