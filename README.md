# iota-curl-browser-pow.js
Library to perform PoW for IOTA in the browser (different implementations)

Copyright 2020-2021 IOTA Stiftung

Copyright 2024 Michael Schierl

Licensed under the Apache License, Version 2.0

## Usage

See [test.html](test.html) for an example.

In a nutshell, include `dist/iota-pow.min.js` as script into your website, which provides a global `iotaPoW` object.

To initialize it, call:

    iotaPoW.initWorker("path/to/iota-pow.min.js");

and optionally

	iotaPoW.initWasm("path/to/impl.wasm");

to load a WebAssembly implementation (`normal` or `simd`). There is also a `reference` WebAssembly implementation available which is a copy of the original code by the IOTA Foundation. To unload the WebAssemblyImplementation and use plain JavaScfript instead, call

    iotaPoW.initWasm(null);

To perform PoW, call

        iotaPoW(blockHash, targetZeros, minNonce, workerCount, maxNonce, timeoutMillis).then(nonce => {
            // we have a nonce
        });

where

- `blockHash` *(string)*: Hash of the block without nonce
- `targetZeros` *(number)*: Number of target zeros in the Curl hash
- `minNonce` *(bigint)*: First nonce to try
- `workerCount` *(number | undefined)* Number of workers to use, or 0 to run inline
- `maxNonce` *(bigint | undefined)* Last nonce to try (`0xffffffffffffffffn` if unset)
- `timeoutMillis` *(number | undefined)* Number of milliseconds to try at most (does not work if running wasm version inline!)

and either obtain a nonce (as `bigint`) or `null` if the operation timed out or exceeded search range.
