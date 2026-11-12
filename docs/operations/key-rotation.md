# Key rotation

The platform signs agent tokens and identity documents with a single EdDSA signing key. Rotation replaces the private
key without breaking verification of anything signed by the outgoing key.

## How key ids work

Each signing key gets a key id (`kid`) equal to the first 16 characters of its public JWK `x` coordinate. The current
key is published at `/api/v1/jwks` and `/.well-known/jwks.json`. Retired public keys are published from the
`AUTHAB_JWKS_PREVIOUS` environment variable, a JSON array of public JWKs. An entry without a `kid` is given the same
derived id, so verification matches the header of documents signed before the rotation. An invalid value is logged and
ignored; it never blocks startup.

## Procedure

1. **Export the current public JWK.** Fetch either JWKS endpoint and copy the single key that is currently in use
   (`"use": "sig"`). It looks like:

   ```json
   { "kty": "OKP", "crv": "Ed25519", "x": "<base64url public key>", "kid": "<16 chars>", "use": "sig", "alg": "EdDSA" }
   ```

2. **Add it to `AUTHAB_JWKS_PREVIOUS`** as a JSON array and deploy that change *before* touching the signing key:

   ```bash
   AUTHAB_JWKS_PREVIOUS='[{"kty":"OKP","crv":"Ed25519","x":"<old public key>","kid":"<old kid>","use":"sig","alg":"EdDSA"}]'
   ```

3. **Confirm both keys are published.** `GET /api/v1/jwks` returns two entries: the current key and the retired one.

4. **Swap `JWT_SIGNING_PRIVATE_KEY`** to the new PKCS#8 DER (base64) key and deploy. New tokens and identity documents
   are signed with the new `kid`; the retired key remains published for verification. Every agent's identity document
   is re-issued on its next lifecycle event, and the nightly cron re-issues any that still embed the old fingerprint.

5. **Keep the retired key** until every token issued under it has expired (maximum token TTL is one hour) and any
   verifier that caches documents has refreshed. Thirty days is a safe default. Then remove it from
   `AUTHAB_JWKS_PREVIOUS`.

## Verification after rotation

```bash
# Documents signed by the retired key must still verify.
authab agents identity <agent-id>                    # prints the current JWS
curl -s https://api.authab.dev/api/v1/jwks | jq .     # both keys present
```

If a document fails verification, the retired key is missing from `AUTHAB_JWKS_PREVIOUS` or was edited (a changed `x`
changes the derived `kid`). Restore the exact JWK from step 1 and redeploy; do not regenerate it from the old private
key unless you still hold that key.

## Notes

- Never put a private key in `AUTHAB_JWKS_PREVIOUS`; only public JWKs are read.
- The master key used for `org_ref` derivation is separate from the JWT signing key. Rotating the signing key does not
  change `org_ref` values, by design: they must stay stable across key rotations.
