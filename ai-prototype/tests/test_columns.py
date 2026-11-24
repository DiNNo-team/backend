"""Columnas: una exportación que no tiene exactamente las columnas de export:data se rechaza con un mensaje claro."""

import shutil

import pytest

from conftest import FIXTURE_EXPORT
from metrics import ExportFormatError, load_export


def copy_fixture(tmp_path):
    folder = tmp_path / "export"
    shutil.copytree(FIXTURE_EXPORT, folder)
    return folder


def rewrite_header(path, transform):
    lines = path.read_text(encoding="utf-8").splitlines(keepends=True)
    lines[0] = transform(lines[0].rstrip("\n")) + "\n"
    path.write_text("".join(lines), encoding="utf-8")


def test_missing_column_is_named(tmp_path):
    folder = copy_fixture(tmp_path)
    rewrite_header(folder / "table_logs.csv", lambda header: header.removesuffix(",actor_type"))
    with pytest.raises(ExportFormatError, match=r"table_logs\.csv .*Faltan: \['actor_type'\]"):
        load_export(folder)


def test_extra_column_is_named(tmp_path):
    folder = copy_fixture(tmp_path)
    path = folder / "check_ins.csv"
    lines = path.read_text(encoding="utf-8").splitlines()
    path.write_text("\n".join(line + ",x" for line in lines) + "\n", encoding="utf-8")
    rewrite_header(path, lambda header: header.removesuffix(",x") + ",correo")
    with pytest.raises(ExportFormatError, match=r"check_ins\.csv .*Sobran: \['correo'\]"):
        load_export(folder)


def test_missing_file_is_named(tmp_path):
    folder = copy_fixture(tmp_path)
    (folder / "reservations.csv").unlink()
    with pytest.raises(ExportFormatError, match=r"Falta reservations\.csv"):
        load_export(folder)


def test_fixture_export_loads():
    frames = load_export(FIXTURE_EXPORT)
    assert len(frames["reservations.csv"]) == 14
