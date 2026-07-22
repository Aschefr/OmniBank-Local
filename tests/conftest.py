import os
import sys

# Ensure tests use an isolated test database instead of production omnibank.db
os.environ["DATABASE_URL"] = "sqlite:///data/omnibank_test.db"

sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
