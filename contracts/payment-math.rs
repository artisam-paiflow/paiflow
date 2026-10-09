/// Exact floor(amount * bps / 10_000) without overflowing the intermediate
/// product. For nonnegative amounts and bps <= 10_000 the result fits in i128.
pub fn percentage_share(amount: i128, bps: u32) -> Option<i128> {
    if amount < 0 || bps > 10_000 {
        return None;
    }
    let bps = i128::from(bps);
    let whole = (amount / 10_000).checked_mul(bps)?;
    let fraction = (amount % 10_000).checked_mul(bps)?.checked_div(10_000)?;
    whole.checked_add(fraction)
}

#[cfg(test)]
mod tests {
    use super::percentage_share;

    #[test]
    fn exact_rounding_matches_direct_math_when_product_fits() {
        for amount in [0, 1, 9_999, 10_000, 10_001, 123_456_789, i128::MAX / 10_000] {
            for bps in [0, 1, 3_333, 5_000, 9_999, 10_000] {
                assert_eq!(
                    percentage_share(amount, bps),
                    Some(amount * i128::from(bps) / 10_000)
                );
            }
        }
    }

    #[test]
    fn supports_full_i128_range_and_rejects_invalid_inputs() {
        assert_eq!(percentage_share(i128::MAX, 10_000), Some(i128::MAX));
        assert_eq!(percentage_share(i128::MAX, 5_000), Some(i128::MAX / 2));
        assert_eq!(percentage_share(i128::MAX, 0), Some(0));
        assert_eq!(percentage_share(-1, 1), None);
        assert_eq!(percentage_share(1, 10_001), None);
    }
}
