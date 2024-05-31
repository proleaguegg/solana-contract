use anchor_lang::prelude::*;

#[account]
pub struct Global {
    pub bump: u8,
    pub whitelist_mint: Vec<Pubkey>,
}

impl Global {
    // Function to calculate the size of the account.
    pub fn get_size(num_whitelist_mint: usize) -> usize {
        // size of bump (u8) + size of Vec<Pubkey>
        let size_of_pubkey = 32; // Each Pubkey is 32 bytes
        let size_of_vec = 4; // Vec length prefix is 4 bytes
        1 + size_of_vec + (num_whitelist_mint * size_of_pubkey)
    }

    // Function to set default values for the struct.
    pub fn set_defaults(&mut self) {
        self.bump = 0;
        self.whitelist_mint = Vec::new();
    }
}
