// Copyright 2020-2021 IOTA Stiftung
// Copyright 2024 Michael Schierl
//
// SPDX-License-Identifier: Apache-2.0

const HASH_LENGTH: u8 = 243;
const STATE_LENGTH: u16 = 3 * HASH_LENGTH;
const TRUTH_TABLE: StaticArray<i8> = [1, 0, -1, 2, 1, -1, 0, 2, -1, 1, 0];
let nonceResult: u64;
const inputTrits: StaticArray<i8> = new StaticArray<i8>(STATE_LENGTH);
const temp1Trits: StaticArray<i8> = new StaticArray<i8>(STATE_LENGTH);
const temp2Trits: StaticArray<i8> = new StaticArray<i8>(STATE_LENGTH);

@inline
function b1t6Encode(src: u8, startIndex: u32): void {
    const v = <i8>(src) + 364;
    const quo: i8 = <i8>(v / 27);
    const rem: i8 = <i8>(v % 27);
    unchecked((inputTrits[startIndex] = rem % 3 - 1));
    unchecked((inputTrits[startIndex + 1] = (rem / 3 | 0) % 3 - 1));
    unchecked((inputTrits[startIndex + 2] = (rem / 9 | 0) % 3 - 1));
    unchecked((inputTrits[startIndex + 3] = quo % 3 - 1));
    unchecked((inputTrits[startIndex + 4] = (quo / 3 | 0) % 3 - 1));
    unchecked((inputTrits[startIndex + 5] = (quo / 9 | 0) % 3 - 1));
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
    let inState: StaticArray<i8>, outState: StaticArray<i8>, index: i32;

    while (nonce <= endNonce) {
        index = 32 * 6;
        for (let i: u8 = 0; i < updateBits; i += 8) {
            b1t6Encode(<u8>(nonce >>> i), index);
            index += 6;
        }
        index = 0;
        inState = inputTrits;
        outState = temp1Trits;
        for (let round: u8 = 0; round < 81; round++) {
            for (let i: u32 = 0; i < STATE_LENGTH; i++) {
                const lastVal = unchecked(inState[index]);
                if (index < 365) {
                    index += 364;
                } else {
                    index -= 365;
                }
                const nextVal = unchecked(inState[index] << 2);
                unchecked((outState[i] = TRUTH_TABLE[lastVal + nextVal + 5]));
            }
            inState = outState;
            outState = inState === temp1Trits ? temp2Trits : temp1Trits;
        }

        let i: u8 = HASH_LENGTH - targetZeros;
        while (i < HASH_LENGTH) {
            if (unchecked(inState[i]) !== 0) {
                break;
            }
            i++;
        }
        if (i == HASH_LENGTH) {
            nonceResult = nonce;
            return;
        }
        nonce++;
        updateBits = <u8>ctz<u64>(nonce) + 1;
    }
    nonceResult = endNonce + 1;
}
