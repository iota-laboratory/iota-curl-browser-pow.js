// Copyright 2020-2021 IOTA Stiftung
// Copyright 2024 Michael Schierl
//
// SPDX-License-Identifier: Apache-2.0

const HASH_LENGTH: u8 = 243;
const STATE_LENGTH: u16 = 3 * HASH_LENGTH;
let nonceResult: u64;
const inputTrits: StaticArray<v128> = new StaticArray<v128>(STATE_LENGTH);
const temp1Trits: StaticArray<v128> = new StaticArray<v128>(STATE_LENGTH);
const temp2Trits: StaticArray<v128> = new StaticArray<v128>(STATE_LENGTH);

@inline
function b1t6Encode(src: u8, startIndex: u32): void {
    const v = <i8>(src) + 364;
    const quo: i8 = <i8>(v / 27);
    const rem: i8 = <i8>(v % 27);
    unchecked((inputTrits[startIndex] = i8x16.splat(rem % 3 - 1)));
    unchecked((inputTrits[startIndex + 1] = i8x16.splat((rem / 3 | 0) % 3 - 1)));
    unchecked((inputTrits[startIndex + 2] = i8x16.splat((rem / 9 | 0) % 3 - 1)));
    unchecked((inputTrits[startIndex + 3] = i8x16.splat(quo % 3 - 1)));
    unchecked((inputTrits[startIndex + 4] = i8x16.splat((quo / 3 | 0) % 3 - 1)));
    unchecked((inputTrits[startIndex + 5] = i8x16.splat((quo / 9 | 0) % 3 - 1)));
}

@inline
function b1t6EncodeLaneRaw(src: u8, ptr: usize): void {
    const v = <i8>(src) + 364;
    const quo: i8 = <i8>(v / 27);
    const rem: i8 = <i8>(v % 27);
    store<u8>(ptr, rem % 3 - 1);
    store<u8>(ptr, (rem / 3 | 0) % 3 - 1, 0x10);
    store<u8>(ptr, (rem / 9 | 0) % 3 - 1, 0x20);
    store<u8>(ptr, quo % 3 - 1, 0x30);
    store<u8>(ptr, (quo / 3 | 0) % 3 - 1, 0x40);
    store<u8>(ptr, (quo / 9 | 0) % 3 - 1, 0x50);
}

export function setDigest(index: u32, value: u8): void {
    b1t6Encode(value, index * 6);
}

export function getNonceLo(): u32 {
    return <u32>(nonceResult & 0xffffffff);
}

export function getNonceHi(): u32 {
    return <u32>((nonceResult >> 32) & 0xffffffff);
}

export function powWorker(targetZeros: u8, startIndexLo: u32, startIndexHi: u32, endIndexLo: u32, endIndexHi: u32): void {
    let nonce: u64 = ((<u64>startIndexHi) << 32) | (<u64>startIndexLo), updateBits: u8 = 64;
    let endNonce: u64 = ((<u64>endIndexHi) << 32) | (<u64>endIndexLo);
    let inState: StaticArray<v128>, outState: StaticArray<v128>, index: i32;
    const truthTable: v128 = i8x16(1, 0, -1, 2, 1, -1, 0, 2, -1, 1, 0, 3, 3, 3, 3, 3);
    const v128_zero: v128 = i8x16.splat(0);
    const v128_five: v128 = i8x16.splat(5);
    const pointer: usize = changetype<usize>(inputTrits) + 32 * 6 * 0x10;

    if ((nonce & 0x0f) != 0) nonce = (nonce + 15) / 16 * 16;
    if ((endNonce & 0x0f) != 0x0f) endNonce = endNonce / 16 * 16 - 1;

    while (nonce <= endNonce) {
        for (let lane: u8 = 0; lane < 16; lane++) {
            b1t6EncodeLaneRaw(<u8>(nonce + lane), pointer + lane);
        }
        index = 33 * 6;
        for (let i: u8 = 8; i < updateBits; i += 8) {
            b1t6Encode(<u8>(nonce >>> i), index);
            index += 6;
        }
        index = 0;
        inState = inputTrits;
        outState = temp1Trits;
        for (let round: u8 = 0; round < 81; round++) {
            for (let i: u32 = 0; i < STATE_LENGTH; i++) {
                const lastVal: v128 = unchecked(inState[index]);
                if (index < 365) {
                    index += 364;
                } else {
                    index -= 365;
                }
                const nextVal: v128 = unchecked(i8x16.shl(inState[index], 2));
                const tableIdx: v128 = i8x16.add(i8x16.add(lastVal, nextVal), v128_five);
                unchecked((outState[i] = i8x16.swizzle(truthTable, tableIdx)));
            }
            inState = outState;
            outState = inState === temp1Trits ? temp2Trits : temp1Trits;
        }
        let joinedBits: v128 = unchecked(inState[HASH_LENGTH - 1])
        for (let i: u8 = HASH_LENGTH - targetZeros; i < HASH_LENGTH - 1; i++) {
            joinedBits = v128.or(joinedBits, unchecked(inState[i]));
        }
        if (!i8x16.all_true(joinedBits)) {
            const minLane: i32 = ctz<i32>(i8x16.bitmask(i8x16.eq(joinedBits, v128_zero)));
            nonceResult = nonce + minLane;
            return;
        }
        nonce += 16;
        updateBits = <u8>ctz<u64>(nonce) + 1;
    }
    nonceResult = endNonce + 1;
}
