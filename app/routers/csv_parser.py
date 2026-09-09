"""
Shim de rétrocompatibilité — csv_parser a été déplacé vers app/services/csv_parser.py.
Ce fichier re-exporte tout pour que les imports existants continuent de fonctionner.
"""
from app.services.csv_parser import *  # noqa: F401,F403
