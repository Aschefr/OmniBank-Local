"""
app/services/chat/chat_tools.py — Shim de rétrocompatibilité.

Les implémentations ont été déplacées dans les sous-modules :
  - tools/read_tools.py       : Outils RAG en lecture seule
  - tools/write_tools.py      : Outils de mutation CRUD
  - tools/analysis_tools.py   : Analyse approfondie (anomalies, audit)
  - tools/simulation_tools.py : Simulation financière (prêt, scénario)
  - tools/__init__.py          : Registry TOOLS + re-exports

Ce fichier re-exporte tout pour que les imports existants continuent de fonctionner.
"""
from app.services.chat.tools import *  # noqa: F401,F403
from app.services.chat.tools import TOOLS  # noqa: F401
