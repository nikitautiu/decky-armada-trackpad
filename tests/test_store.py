"""Tests for the versioned JSON profile store file."""

import json
import os
from pathlib import Path

import pytest
from armada_trackpad_plugin.profiles import GameProfile, Store
from armada_trackpad_plugin.store import MAX_STORE_BYTES, load, save


def _store() -> Store:
    """A store with every field set: two games, one disabled, wire-form values of each kind, Actives that differ."""
    return Store(
        last_instance="4eea7756e9346454",
        daemon_profile="game:2379780",
        global_settings={"right.anchor": "float", "left.size": None, "edges": ["clamp", "clamp", "clamp", "clamp"]},
        games={
            2379780: GameProfile("Balatro", True, {"size": 1.5, "pads": "left", "flag": True, "n": 3}, active=True),
            70: GameProfile("Half-Life", False, {}, active=False),
        },
        global_active=True,
    )


def _game(**overrides: object) -> dict[str, object]:
    """A valid game entry with `overrides` applied."""
    return {"name": "A", "enabled": True, "active": False, "settings": {}, **overrides}


def _document(**overrides: object) -> bytes:
    """A valid store document with `overrides` applied to its top-level keys."""
    document: dict[str, object] = {
        "version": 2,
        "last_instance": None,
        "daemon_profile": "global",
        "global": {},
        "global_active": False,
        "games": {},
    }
    document.update(overrides)
    return json.dumps(document).encode()


def _version_1() -> bytes:
    """A store document of another version than the current one, shaped as that version would be."""
    document = {"version": 1, "last_instance": "4eea7756e9346454", "daemon_profile": "global", "global": {}}
    return json.dumps({**document, "games": {"7": {"name": "A", "enabled": True, "settings": {}}}}).encode()


class TestLoad:
    """Reading the store file."""

    def test_load_missing_file_gives_empty_store_and_exists_false(self, tmp_path: Path) -> None:
        """A first run has no file: an empty store, no warning."""
        loaded = load(tmp_path / "profiles.json")
        assert loaded.store == Store()
        assert not loaded.exists
        assert loaded.warning is None

    def test_round_trip_keeps_every_field(self, tmp_path: Path) -> None:
        """What `save` writes, `load` returns unchanged."""
        path = tmp_path / "profiles.json"
        save(path, _store())
        loaded = load(path)
        assert loaded.store == _store()
        assert loaded.exists
        assert loaded.warning is None

    def test_load_moves_corrupt_file_to_bad_and_warns(self, tmp_path: Path) -> None:
        """Unparseable bytes are kept aside as `.bad` and the plugin starts empty."""
        path = tmp_path / "profiles.json"
        path.write_bytes(b"{not json")
        loaded = load(path)
        assert (tmp_path / "profiles.json.bad").read_bytes() == b"{not json"
        assert not path.exists()
        assert loaded.store == Store()
        assert loaded.exists
        assert loaded.warning is not None
        assert "profiles.json.bad" in loaded.warning

    def test_load_replaces_older_bad_copy_when_file_corrupt(self, tmp_path: Path) -> None:
        """A new bad file overwrites the previous `.bad` copy."""
        path = tmp_path / "profiles.json"
        (tmp_path / "profiles.json.bad").write_bytes(b"old")
        path.write_bytes(b"[")
        load(path)
        assert (tmp_path / "profiles.json.bad").read_bytes() == b"["

    @pytest.mark.parametrize(
        "content",
        [
            _document(version=3),
            _document(version=True),
            b"x" * (MAX_STORE_BYTES + 1),
            b"[]",
            _document(games={"abc": _game()}),
            _document(games={"0": _game()}),
            _document(games={"4294967296": _game()}),
            _document(games={"07": _game()}),
            _document(games={"7": _game(), "7 ": 1}),
            _document(games={"7": _game(settings={"k": {"a": 1}})}),
            _document(games={"7": _game(name="A" * 129)}),
            _document(games={"7": _game(enabled=1)}),
            _document(games={"7": _game(active=1)}),
            _document(games={"7": {"name": "A", "enabled": True, "settings": {}}}),
            _document(games={"7": _game(extra=1)}),
            _document(games={str(i): _game() for i in range(1, 202)}),
            _document(global_active=None),
            _version_1(),
            _document(daemon_profile="game:abc"),
            _document(daemon_profile="game:0"),
            _document(daemon_profile="elsewhere"),
            _document(last_instance=5),
            _document(**{"global": {"k": [1]}}),
            _document(**{"global": {"k": float("nan")}}),
            _document(version=[2]),
            _document(version={}),
            _document(version="2"),
            _document(version=True),
            _document(version=2.0),
        ],
        ids=lambda content: f"{len(content)}b-{content[:48]!r}",
    )
    def test_load_rejects(self, tmp_path: Path, content: bytes) -> None:
        """Invalid content is moved aside and the plugin starts empty with a warning."""
        path = tmp_path / "profiles.json"
        path.write_bytes(content)
        loaded = load(path)
        assert loaded.store == Store()
        assert loaded.exists
        assert loaded.warning is not None
        assert (tmp_path / "profiles.json.bad").read_bytes() == content

    def test_load_moves_fifo_aside_without_blocking(self, tmp_path: Path) -> None:
        """A FIFO at the path is not a regular file: it is moved aside rather than read."""
        path = tmp_path / "profiles.json"
        os.mkfifo(path)
        loaded = load(path)
        assert loaded.store == Store()
        assert loaded.warning is not None
        assert not path.exists()
        assert (tmp_path / "profiles.json.bad").exists()

    def test_load_renames_symlink_without_following_it(self, tmp_path: Path) -> None:
        """A symlink is bad: the link itself is moved aside and its target is left alone."""
        target = tmp_path / "target.json"
        target.write_bytes(_document())
        path = tmp_path / "profiles.json"
        path.symlink_to(target)
        loaded = load(path)
        assert loaded.store == Store()
        assert loaded.warning is not None
        assert (tmp_path / "profiles.json.bad").is_symlink()
        assert not path.exists()
        assert target.read_bytes() == _document()


class TestSave:
    """Writing the store file."""

    def test_save_replaces_atomically_without_leftover_temp_files(self, tmp_path: Path) -> None:
        """Saving twice leaves exactly the store file, mode 0600."""
        path = tmp_path / "profiles.json"
        save(path, Store())
        save(path, _store())
        assert os.listdir(tmp_path) == ["profiles.json"]
        assert path.stat().st_mode & 0o777 == 0o600
        assert json.loads(path.read_text())["version"] == 2

    def test_save_replaces_a_symlink_instead_of_writing_through_it(self, tmp_path: Path) -> None:
        """A symlinked store path is replaced; the link target is untouched."""
        target = tmp_path / "target.json"
        target.write_bytes(b"keep")
        path = tmp_path / "profiles.json"
        path.symlink_to(target)
        save(path, _store())
        assert not path.is_symlink()
        assert target.read_bytes() == b"keep"
        assert load(path).store == _store()

    def test_save_raises_and_writes_nothing_when_encoding_exceeds_cap(self, tmp_path: Path) -> None:
        """An over-cap encoding is refused before touching the file."""
        path = tmp_path / "profiles.json"
        save(path, Store())
        before = path.read_bytes()
        big = Store(global_settings={f"k{i}": "x" * 60 for i in range(5000)})
        with pytest.raises(ValueError, match="exceeds"):
            save(path, big)
        assert path.read_bytes() == before
        assert os.listdir(tmp_path) == ["profiles.json"]

    @pytest.mark.parametrize(
        "store",
        [
            Store(global_settings={"k": float("nan")}),
            Store(games={7: GameProfile("A" * 129, True, {})}),
            Store(daemon_profile="elsewhere"),
            Store(games={i: GameProfile("A", True, {}) for i in range(1, 202)}),
        ],
        ids=["nan", "long-name", "bad-daemon-profile", "too-many-games"],
    )
    def test_save_raises_and_keeps_file_when_load_would_reject(self, tmp_path: Path, store: Store) -> None:
        """A store `load` would reject is refused, the old file stays and no temp file is left."""
        path = tmp_path / "profiles.json"
        save(path, _store())
        before = path.read_bytes()
        with pytest.raises(ValueError):
            save(path, store)
        assert path.read_bytes() == before
        assert os.listdir(tmp_path) == ["profiles.json"]

    def test_save_cleans_up_temp_file_when_write_fails(self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
        """A failing fsync (a filesystem boundary) leaves the original intact and no temp file."""
        path = tmp_path / "profiles.json"
        save(path, Store())
        before = path.read_bytes()

        def fail(_fd: int) -> None:
            """Simulate a full disk."""
            raise OSError("disk full")

        monkeypatch.setattr(os, "fsync", fail)
        with pytest.raises(OSError, match="disk full"):
            save(path, _store())
        assert path.read_bytes() == before
        assert os.listdir(tmp_path) == ["profiles.json"]
