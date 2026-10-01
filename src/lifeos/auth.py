"""OAuth protection for the remotely exposed LifeOS MCP endpoint."""

from __future__ import annotations

from fastmcp.server.auth.auth import AccessToken
from fastmcp.server.auth.oauth_proxy import OAuthProxy
from fastmcp.server.auth.providers.github import GitHubTokenVerifier

from .runtime import RuntimeConfig


class RestrictedGitHubTokenVerifier(GitHubTokenVerifier):
    """Accept GitHub tokens only for the configured personal account."""

    def __init__(self, *, allowed_login: str) -> None:
        super().__init__(required_scopes=["user"], cache_ttl_seconds=300)
        self.allowed_login = allowed_login.casefold()

    async def verify_token(self, token: str) -> AccessToken | None:
        access_token = await super().verify_token(token)
        if access_token is None:
            return None
        login = access_token.claims.get("login")
        if not isinstance(login, str) or login.casefold() != self.allowed_login:
            return None
        return access_token


def build_github_auth(config: RuntimeConfig) -> OAuthProxy:
    """Build ChatGPT-compatible OAuth using GitHub as the identity provider."""

    if not config.oauth_enabled:
        raise ValueError("GitHub OAuth is not fully configured")

    verifier = RestrictedGitHubTokenVerifier(allowed_login=config.github_allowed_login)
    return OAuthProxy(
        upstream_authorization_endpoint="https://github.com/login/oauth/authorize",
        upstream_token_endpoint="https://github.com/login/oauth/access_token",
        upstream_client_id=config.github_client_id,
        upstream_client_secret=config.github_client_secret,
        token_verifier=verifier,
        base_url=config.public_base_url,
        resource_base_url=config.public_base_url,
        issuer_url=config.public_base_url,
        valid_scopes=["user"],
        require_authorization_consent=True,
        enable_cimd=True,
    )
