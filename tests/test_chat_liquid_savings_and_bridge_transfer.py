"""
tests/test_chat_liquid_savings_and_bridge_transfer.py — Tests for liquid savings injection,
overdraft prevention, and recommended bridge transfer in chat briefing and tools.
"""
from datetime import date, timedelta
import pytest
from app.database import SessionLocal
from app.models import Account, Transaction, GlobalConfig
from app.services.chat.chat_briefing import generate_financial_briefing
from app.services.chat.chat_prompt import load_system_prompt
from app.services.chat.tools.read_tools import get_financial_summary_tool


def test_briefing_includes_liquid_savings_and_bridge_transfer():
    db = SessionLocal()
    try:
        briefing = generate_financial_briefing(db, role='advisor')
        assert "Available Liquid Savings & Reserve (Épargne disponible):" in briefing
        assert "Livret A" in briefing
        assert "Recommended Bridge Transfer (Virement de précaution):" in briefing
        assert "Daily Spending Ceiling on Checking Account:" in briefing
    finally:
        db.close()


def test_financial_summary_tool_includes_savings_and_bridge_transfer():
    db = SessionLocal()
    try:
        summary = get_financial_summary_tool(db)
        assert "available_liquid_savings_euros" in summary
        assert summary["available_liquid_savings_euros"] > 0
        assert "liquid_accounts_breakdown" in summary
        assert "Livret A" in summary["liquid_accounts_breakdown"]
        assert "recommended_bridge_transfer" in summary
        rec = summary["recommended_bridge_transfer"]
        if rec:
            assert rec["recommended_amount_euros"] > 0
            assert rec["deficit_to_cover_euros"] > 0
            assert rec["vital_living_buffer_euros"] > 0
    finally:
        db.close()


def test_advisor_system_prompt_includes_bridge_transfer_directive():
    db = SessionLocal()
    try:
        prompt = load_system_prompt(role='advisor', db=db, lang='fr')
        assert "LIQUIDITY DEFICIT, OVERDRAFT PREVENTION & BRIDGE TRANSFER DIRECTIVE" in prompt
        assert "NEVER PANIC OR PREACH SURVIVAL MODE IF LIQUID SAVINGS ARE AVAILABLE" in prompt
        assert "RECOMMEND AN EXACT PRECAUTIONARY BRIDGE TRANSFER" in prompt
        assert "Livret A" in prompt
    finally:
        db.close()
