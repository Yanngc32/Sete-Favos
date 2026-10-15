# Gera dist/central/ (central.exe + dependências). Rodar na raiz do repo, depois do `npm run build`:
#   backend\.venv\Scripts\pyinstaller packaging\central.spec --noconfirm
# onedir (não onefile): sobe mais rápido, gera menos alarme de antivírus e o instalador troca a pasta inteira.
from pathlib import Path

from PyInstaller.utils.hooks import collect_submodules, copy_metadata

ROOT = Path(SPECPATH).parent
DIST = ROOT / "frontend" / "dist"
if not (DIST / "index.html").is_file():
    raise SystemExit(f"Falta o painel em {DIST}: rode `npm ci && npm run build` em frontend/")

a = Analysis(
    [str(ROOT / "packaging" / "entry.py")],
    pathex=[str(ROOT / "backend" / "src")],
    datas=[
        (str(DIST), "frontend/dist"),
        (str(ROOT / "backend" / "src" / "casa" / "update.ps1"), "casa"),
        # Versão (importlib.metadata) e backends do keyring (entry points) vêm dos metadados.
        *copy_metadata("casa"),
        *copy_metadata("keyring"),
    ],
    hiddenimports=[
        *collect_submodules("casa"),
        *collect_submodules("uvicorn"),
        "keyring.backends.Windows",
    ],
    excludes=["tkinter", "pytest"],
    noarchive=False,
)
pyz = PYZ(a.pure)
exe = EXE(
    pyz,
    a.scripts,
    [],
    exclude_binaries=True,
    name="central",
    console=True,
    upx=False,
)
coll = COLLECT(exe, a.binaries, a.datas, name="central", upx=False)
