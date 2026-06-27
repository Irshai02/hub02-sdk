"""Pytest fixtures backed by the importable helpers in ``_helpers``."""

from __future__ import annotations

import pytest

from ._helpers import KeyPair, MockJwks, make_keys


@pytest.fixture
def keys() -> KeyPair:
    return make_keys("kid-A")


@pytest.fixture
def jwks(keys: KeyPair) -> MockJwks:
    return MockJwks(keys)
