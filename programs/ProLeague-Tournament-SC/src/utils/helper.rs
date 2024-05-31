use crate::errors::TournamentError;
use anchor_lang::prelude::{AccountInfo, Program, Rent, Result, System, Sysvar, ToAccountInfo};
use anchor_lang::solana_program;

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
