"""Integrador da casa."""

from importlib.metadata import PackageNotFoundError, version

# Fonte única: `version` do pyproject.toml (a tag vX.Y.Z do release tem que bater com ela).
try:
    __version__ = version("casa")
except PackageNotFoundError:  # rodando direto do código, sem instalar o pacote
    __version__ = "0.0.0+dev"
