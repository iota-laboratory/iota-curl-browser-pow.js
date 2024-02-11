// Copyright 2020-2021 IOTA Stiftung
// Copyright 2024 Michael Schierl
//
// SPDX-License-Identifier: Apache-2.0

"use strict";

var iotaPoW = (function () {

    let _wasmBuffer = null;

    // internal implementation
    let powImpl = function (blockHash, targetZeros, minNonce, maxNonce, timeoutMillis) {
        if (_wasmBuffer != null) {
            // WebAssembly implementation
            if (timeoutMillis !== undefined)
                throw "Millisecond timeout not supported with WASM run outside of worker";

            return new Promise((resolved, _) => {
                WebAssembly.instantiate(_wasmBuffer, { env: { abort: console.error } }).then(function (wmi) {
                    let wasmObject = wmi.instance;
                    for (let i = 0; i < 32; i++) {
                        wasmObject.exports.setDigest(i, parseInt(blockHash.substring(i * 2 + 2, i * 2 + 4), 16));
                    }
                    wasmObject.exports.powWorker(targetZeros,
                        Number(minNonce & 0xffffffffn), Number((minNonce >> 32n) & 0xffffffffn),
                        Number(maxNonce & 0xffffffffn), Number((maxNonce >> 32n) & 0xffffffffn));
                    let nonce = BigInt(wasmObject.exports.getNonceLo()) + (BigInt(wasmObject.exports.getNonceHi()) << 32n);
                    resolved(nonce <= maxNonce ? nonce : null);
                });
            });
        } else {
            // pure JS implementation
            const startTime = Date.now();
            const HASH_LENGTH = 243;
            const STATE_LENGTH = 3 * HASH_LENGTH;
            const TRUTH_TABLE = [1, 0, -1, 2, 1, -1, 0, 2, -1, 1, 0];
            const inputTrits = new Int8Array(STATE_LENGTH);
            const temp1Trits = new Int8Array(STATE_LENGTH);
            const temp2Trits = new Int8Array(STATE_LENGTH);

            let b1t6Encode = function (src, startIndex) {
                const v = (src << 24 >> 24) + 364;
                const quo = (v / 27) | 0;
                const rem = (v % 27);
                ((inputTrits[startIndex] = rem % 3 - 1));
                ((inputTrits[startIndex + 1] = (rem / 3 | 0) % 3 - 1));
                ((inputTrits[startIndex + 2] = (rem / 9 | 0) % 3 - 1));
                ((inputTrits[startIndex + 3] = quo % 3 - 1));
                ((inputTrits[startIndex + 4] = (quo / 3 | 0) % 3 - 1));
                ((inputTrits[startIndex + 5] = (quo / 9 | 0) % 3 - 1));
            }

            for (let i = 0; i < 32; i++) {
                b1t6Encode(parseInt(blockHash.substring(i * 2 + 2, i * 2 + 4), 16), i * 6);
            }

            let nonce = minNonce, pow2updateBytes = BigInt("0x8000000000000000");
            let inState, outState, index;

            while (nonce <= maxNonce && (timeoutMillis === undefined || Date.now() < startTime + timeoutMillis)) {
                index = 32 * 6;
                for (let i = 0; pow2updateBytes > 0n; i += 8) {
                    b1t6Encode(Number((nonce >> BigInt(i)) & 0xffn), index);
                    index += 6;
                    pow2updateBytes >>= 8n;
                }
                inState = inputTrits;
                outState = temp1Trits;
                index = 0;
                for (let round = 0; round < 81; round++) {
                    for (let i = 0; i < STATE_LENGTH; i++) {
                        const lastVal = (inState[index]);
                        if (index < 365) {
                            index += 364;
                        } else {
                            index -= 365;
                        }
                        const nextVal = (inState[index] << 2);
                        ((outState[i] = TRUTH_TABLE[lastVal + nextVal + 5]));
                    }
                    inState = outState;
                    outState = inState === temp1Trits ? temp2Trits : temp1Trits;
                }

                let i = HASH_LENGTH - targetZeros;
                while (i < HASH_LENGTH) {
                    if ((inState[i]) !== 0) {
                        break;
                    }
                    i++;
                }
                if (i == HASH_LENGTH) {
                    return Promise.resolve(nonce);
                } else {
                    nonce++;
                    pow2updateBytes = (nonce & -nonce);
                }
            }
            return Promise.resolve(null);
        }
    };

    if (typeof WorkerGlobalScope !== 'undefined' && self instanceof WorkerGlobalScope) {
        // we are inside the worker
        onmessage = function (evt) {
            _wasmBuffer = evt.data.wasmBuffer;
            powImpl(evt.data.hash, evt.data.zeros, evt.data.min, evt.data.max, evt.data.timeout).then(result => {
                postMessage({ nonce: result });
            });
        };
        return null;
    } else {
        // we are inside the main thread

        let _selfURL = null;

        /**
         * Perform PoW to find a nonce.
         *
         * @param {string} blockHash Hash of the block without nonce
         * @param {number} targetZeros Number of target zeros in the Curl hash
         * @param {bigint} minNonce First nonce to try
         * @param {number=} workerCount Number of workers to use, or 0 to run inline
         * @param {bigint=} maxNonce Last nonce to try (0xffffffffffffffff if unset)
         * @param {number=} timeoutMillis Number of milliseconds to try at most (does not work if running wasm version inline!)
         * @returns { Promise<bigint | null> } Promise resolving to the nonce, or null in case of timeout or range exceeded
         */
        let pow = function (blockHash, targetZeros, minNonce, workerCount, maxNonce, timeoutMillis) {
            if (!/^0x[0-9a-f]{64}$/.test(blockHash))
                throw "Invalid block hash: " + blockHash;
            if (!maxNonce) maxNonce = BigInt('0x7fffffffffffffff');
            if (workerCount > 0) {
                return new Promise((resolve, _) => {
                    const workers = [];
                    let timedOutWorkers = 0;
                    for (let i = 0; i < workerCount; i++) {
                        const w = new Worker(_selfURL);
                        workers.push(w);
                        w.onmessage = function (evt) {
                            let nonce = evt.data.nonce;
                            if (nonce == null) {
                                timedOutWorkers++;
                                if (timedOutWorkers < workers.length) {
                                    return;
                                }
                            }
                            for (var ww of workers) {
                                ww.terminate();
                            }
                            resolve(nonce);
                        }
                    }
                    const nonceRange = (maxNonce - minNonce) / BigInt(workers.length);
                    let mNonce = minNonce, xNonce = maxNonce - nonceRange * BigInt(workers.length - 1);
                    for (let i = 0; i < workers.length; i++) {
                        workers[i].postMessage({ wasmBuffer: _wasmBuffer, hash: blockHash, zeros: targetZeros,
                            min: mNonce, max: xNonce, timeout: timeoutMillis });
                        mNonce = xNonce; xNonce += nonceRange;
                    }
                    if (timeoutMillis !== undefined) {
                        setTimeout(function () {
                            for (var ww of workers) {
                                ww.terminate();
                            }
                            resolve(null);
                        }, timeoutMillis);
                    }
                });
            } else {
                return powImpl(blockHash, targetZeros, minNonce, maxNonce, timeoutMillis);
            }
        };

        /**
         * Initialize web worker support.
         *
         * @param {string} selfURL URL this script has been loaded from
         */
        pow.initWorker = function (selfURL) {
            _selfURL = selfURL;
        };

        /**
         * Initialize WebAssembly support from a loaded webassembly ArrayBuffer or URL string.
         *
         * @param {ArrayBuffer | string | null} wasmBuffer ArrayBuffer or URL of the Webassembly file to be used,
         * or null to use JavasScript implementation
         */
        pow.initWasm = function (wasmBuffer) {
            if (wasmBuffer === null || wasmBuffer instanceof ArrayBuffer) {
                _wasmBuffer = wasmBuffer;
            } else {
                fetch(wasmBuffer).then(r => r.arrayBuffer()).then(a => { _wasmBuffer = a; });
            }
        };

        return pow;
    }
})();
