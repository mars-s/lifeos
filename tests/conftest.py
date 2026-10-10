import pytest


@pytest.fixture(autouse=True)
def _no_real_anytype(tmp_path, monkeypatch):
    """No test reads the person's Keychain, Anytype settings or API key."""
    monkeypatch.setenv("LIFEOS_ANYTYPE_NO_KEYCHAIN", "1")
    monkeypatch.setenv("LIFEOS_ANYTYPE_CONFIG", str(tmp_path / "no-anytype.json"))
    for name in ("LIFEOS_ANYTYPE_API_KEY", "LIFEOS_ANYTYPE_API_KEY_FILE", "LIFEOS_ANYTYPE_URL",
                 "LIFEOS_ANYTYPE_SPACE_ID", "LIFEOS_ANYTYPE_CHAT_ID"):
        monkeypatch.delenv(name, raising=False)
