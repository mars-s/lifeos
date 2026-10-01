from __future__ import annotations

import pytest
from fastmcp.server.auth.auth import AccessToken
from fastmcp.server.auth.providers.github import GitHubTokenVerifier

from lifeos.auth import RestrictedGitHubTokenVerifier, build_github_auth
from lifeos.runtime import RuntimeConfig


@pytest.mark.asyncio
@pytest.mark.parametrize(("login", "allowed"), [("mars-s", True), ("someone-else", False)])
async def test_github_verifier_restricts_access_to_one_login(monkeypatch, login, allowed):
    async def verified_token(_self, _token):
        return AccessToken(
            token="upstream-token",
            client_id="1234",
            scopes=["user"],
            claims={"login": login},
        )

    monkeypatch.setattr(GitHubTokenVerifier, "verify_token", verified_token)
    verifier = RestrictedGitHubTokenVerifier(allowed_login="Mars-S")

    result = await verifier.verify_token("candidate-token")

    assert (result is not None) is allowed


def test_build_github_auth_from_complete_runtime_config():
    config = RuntimeConfig(
        transport="streamable-http",
        public_base_url="https://fixed-domain.ngrok-free.app",
        github_client_id="client-id",
        github_client_secret="client-secret",
        github_allowed_login="mars-s",
    )

    auth = build_github_auth(config)

    assert str(auth.base_url) == "https://fixed-domain.ngrok-free.app/"
