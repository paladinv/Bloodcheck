export async function detectWebAuthnPrfCapability(env = globalThis) {
  const PublicKeyCredentialLike = env?.PublicKeyCredential;
  if (!PublicKeyCredentialLike || typeof PublicKeyCredentialLike.isUserVerifyingPlatformAuthenticatorAvailable !== "function") {
    return { available: false, prf: false, reason: "WebAuthn is unavailable in this browser." };
  }
  try {
    const authenticator = await PublicKeyCredentialLike.isUserVerifyingPlatformAuthenticatorAvailable();
    const capabilities = typeof PublicKeyCredentialLike.getClientCapabilities === "function"
      ? await PublicKeyCredentialLike.getClientCapabilities()
      : {};
    const prf = capabilities?.prf === true;
    return { available: authenticator === true, prf, reason: prf ? "WebAuthn PRF capability detected; unlock integration remains pending security review." : "A platform authenticator may exist, but WebAuthn PRF is not verified." };
  } catch {
    return { available: false, prf: false, reason: "WebAuthn capability could not be determined." };
  }
}
