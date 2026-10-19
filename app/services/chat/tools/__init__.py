"""
app/services/chat/tools/__init__.py — Registry central des outils IA et re-exports.
"""

from app.services.chat.tools.read_tools import (  # noqa: F401
    _compute_recurrence_schedule,
    calculate_daily_variable_spending_rate,
    forecast_balances_history_tool,
    get_active_recurrence_templates,
    get_balances_tool,
    get_budgets_status_tool,
    get_dashboard_synthesis_tool,
    get_envelopes_impact_tool,
    get_financial_summary_tool,
    get_monthly_overview_tool,
    get_net_worth_history_tool,
    get_net_worth_tool,
    get_recent_transactions_tool,
    get_recurrence_templates_tool,
    get_saving_recommendations_tool,
    get_spending_analytics_tool,
    get_spending_trends_tool,
    get_application_knowledge_tool,
    search_similar_past_spends_tool,
    search_transactions_tool,
    suggest_transaction_category_tool,
)

from app.services.chat.tools.write_tools import (  # noqa: F401
    allocate_savings_funds_tool,
    apply_transaction_correction_tool,
    close_recurrence_template_tool,
    create_budget_envelope_tool,
    create_category_tool,
    create_planned_transfer_tool,
    create_recurrence_template_tool,
    delete_budget_envelope_tool,
    delete_category_tool,
    delete_recurrence_template_tool,
    delete_transaction_tool,
    forget_financial_fact_tool,
    generate_csv_export_link_tool,
    set_predicted_paycheck_tool,
    store_financial_fact_tool,
    trigger_bank_sync_tool,
    update_budget_envelope_tool,
    update_recurrence_template_tool,
)

from app.services.chat.tools.analysis_tools import (  # noqa: F401
    audit_transactions_integrity_tool,
    detect_anomalies_and_subscriptions_tool,
)

from app.services.chat.tools.simulation_tools import (  # noqa: F401
    simulate_financial_scenario_tool,
    simulate_loan_amortization_tool,
)

TOOLS = [
    {
        "type": "function",
        "function": {
            "name": "audit_transactions_integrity",
            "description": "Audit the database transactions for data integrity: unreconciled past operations (>30 days), un-categorized operations, suspicious/inverted entries, and missing regular recurring debits. Use this in Auditor mode.",
            "parameters": {"type": "object", "properties": {}}
        }
    },
    {
        "type": "function",
        "function": {
            "name": "simulate_financial_scenario",
            "description": "Run a comprehensive What-If financial sandbox simulation for a future project (vehicle purchase, real estate, sabbatical, renovations) over 3 to 36 months. Computes trajectory, net worth impact, debt capacity ratio, and overdraft risk. Use this in Simulator mode.",
            "parameters": {
                "type": "object",
                "properties": {
                    "horizon_months": {"type": "integer", "description": "Simulation horizon in months (e.g. 6, 12, 24). Default is 12."},
                    "project_name": {"type": "string", "description": "Human name for the project (e.g. 'Achat Moto', 'Travaux Cuisine')."},
                    "one_off_amount": {"type": "number", "description": "Initial one-off expense or down payment."},
                    "recurring_monthly_amount": {"type": "number", "description": "Monthly recurring cost or loan repayment."},
                    "recurring_duration_months": {"type": "integer", "description": "Duration in months of the recurring monthly cost."}
                }
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "get_financial_summary",
            "description": "Get the current 'Reste à vivre' (left to live) amount, daily spending ceiling, days remaining until next paycheck, savings safety buffer, and predicted paycheck details. Use this when the user asks about remaining budget or paycheck projections.",
            "parameters": {"type": "object", "properties": {}}
        }
    },
    {
        "type": "function",
        "function": {
            "name": "get_spending_trends",
            "description": "Get historical spending and income averages over 3, 6, and 12 months, overall savings rate, and identify categories with recent notable spending growth or reduction. Use this for deep financial health analysis and budget optimization advice.",
            "parameters": {"type": "object", "properties": {}}
        }
    },
    {
        "type": "function",
        "function": {
            "name": "get_dashboard_synthesis",
            "description": "Get the complete monthly dashboard synthesis: total income, fixed vs variable expenses, net savings, comparison against previous month (M-1), and consumption status of all budget envelopes. Use this when the user asks about their overall monthly progress or dashboard metrics.",
            "parameters": {
                "type": "object",
                "properties": {
                    "year": {
                        "type": "integer",
                        "description": "Optional year. Defaults to current year."
                    },
                    "month": {
                        "type": "integer",
                        "description": "Optional month (1-12). Defaults to current month."
                    }
                }
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "get_net_worth",
            "description": "Get the total net worth of the user (all accounts and savings combined). Returns reconciled balance (cleared in bank) and projected balance (including future/planned transactions).",
            "parameters": {"type": "object", "properties": {}}
        }
    },
    {
        "type": "function",
        "function": {
            "name": "get_account_balances",
            "description": "Get the balances of all bank accounts and savings envelopes separately. Returns reconciled and projected balances.",
            "parameters": {"type": "object", "properties": {}}
        }
    },
    {
        "type": "function",
        "function": {
            "name": "search_transactions",
            "description": "Search user transactions with various filters. Returns a list of transactions matching the criteria.",
            "parameters": {
                "type": "object",
                "properties": {
                    "description_query": {
                        "type": "string",
                        "description": "Optional keyword search on transaction description."
                    },
                    "category": {
                        "type": "string",
                        "description": "Optional category name."
                    },
                    "type": {
                        "type": "string",
                        "description": "Optional transaction type: expense_var, expense_fixed, income, transfer, neutral."
                    },
                    "start_date": {
                        "type": "string",
                        "description": "Optional start date in YYYY-MM-DD format."
                    },
                    "end_date": {
                        "type": "string",
                        "description": "Optional end date in YYYY-MM-DD format."
                    },
                    "min_amount": {
                        "type": "number",
                        "description": "Optional minimum amount."
                    },
                    "max_amount": {
                        "type": "number",
                        "description": "Optional maximum amount."
                    },
                    "limit": {
                        "type": "integer",
                        "description": "Maximum number of transactions to return (default 50)."
                    }
                }
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "get_spending_analytics",
            "description": "Get aggregated raw spending and income statistics for a specific period, grouped by category and transaction type. Do NOT use this tool for tracking budget envelope limits or remaining budget envelope balances — use get_budgets_status for that.",
            "parameters": {
                "type": "object",
                "properties": {
                    "start_date": {
                        "type": "string",
                        "description": "Start date of the analysis period (YYYY-MM-DD)."
                    },
                    "end_date": {
                        "type": "string",
                        "description": "End date of the analysis period (YYYY-MM-DD)."
                    }
                },
                "required": ["start_date", "end_date"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "get_budgets_status",
            "description": "Get consumption progress and remaining balances of all budget envelopes and savings for a specific year and month. CRITICAL: When the user asks about a specific past or future month (e.g. next month, September -> year=2026, month=9), you MUST pass explicit year and month parameters so the tool returns the correct period and projected recurring commitments instead of the current month.",
            "parameters": {
                "type": "object",
                "properties": {
                    "year": {
                        "type": "integer",
                        "description": "Year to analyze (e.g. 2026). Pass explicitly when analyzing a past or future month."
                    },
                    "month": {
                        "type": "integer",
                        "description": "Month to analyze (1-12). Pass explicitly when analyzing a past or future month (e.g. 9 for September)."
                    }
                }
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "get_recurrence_templates",
            "description": "Get the list of recurring transaction templates (bills, subscriptions, salaries), including their active/closed status, next expected dates, and occurrence counts.",
            "parameters": {
                "type": "object",
                "properties": {
                    "include_closed": {
                        "type": "boolean",
                        "description": "Whether to include closed/archived recurrence templates (default true)."
                    }
                }
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "get_net_worth_history",
            "description": "Get the historical net worth trend data points grouped by month.",
            "parameters": {
                "type": "object",
                "properties": {
                    "months": {
                        "type": "integer",
                        "description": "Number of past months to retrieve (default 12)."
                    }
                }
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "get_envelopes_impact",
            "description": "Simulate the impact of a planned purchase (amount) on user budget envelopes or savings. Returns remaining capacity.",
            "parameters": {
                "type": "object",
                "properties": {
                    "amount": {"type": "number", "description": "The cost of the simulated purchase."},
                    "budget_id": {"type": "integer", "description": "Optional budget envelope ID to test."}
                },
                "required": ["amount"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "suggest_transaction_category",
            "description": "Suggest the most likely category for a transaction description based on existing database history.",
            "parameters": {
                "type": "object",
                "properties": {
                    "description": {"type": "string", "description": "Transaction description (e.g. 'Amazon', 'LIDL')."}
                },
                "required": ["description"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "forecast_balances_history",
            "description": "Forecast account balances and left-to-live trend over next 30, 60, or 90 days. This simulation ALREADY automatically includes future recurring templates and predicted paychecks (salaries/income). Do NOT assume future income is missing from the forecast results.",
            "parameters": {
                "type": "object",
                "properties": {
                    "days": {"type": "integer", "description": "Number of days to forecast (30, 60, 90). Default is 30."}
                }
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "get_monthly_overview",
            "description": "Get a comprehensive monthly overview including budget envelopes status, category spending statistics, rest-to-live details, next paycheck predictions, and account balances in one single tool call. CRITICAL: Pass explicit year and month when analyzing a past or future month.",
            "parameters": {
                "type": "object",
                "properties": {
                    "year": {
                        "type": "integer",
                        "description": "Year to analyze (e.g. 2026). Defaults to current year."
                    },
                    "month": {
                        "type": "integer",
                        "description": "Month to analyze (1-12). Defaults to current month."
                    }
                }
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "detect_anomalies_and_subscriptions",
            "description": "Detect possible active subscriptions, duplicate charges, or suspicious expense spikes in recent months.",
            "parameters": {"type": "object", "properties": {}}
        }
    },
    {
        "type": "function",
        "function": {
            "name": "apply_transaction_correction",
            "description": "Modify a transaction category, date, description, or amount in the database upon user request. Identify by transaction_id or by description/amount/date.",
            "parameters": {
                "type": "object",
                "properties": {
                    "transaction_id": {"type": "integer", "description": "The ID of the transaction to update (if known)."},
                    "category": {"type": "string", "description": "New category name (optional)."},
                    "description": {"type": "string", "description": "New description or matching description keyword."},
                    "amount": {"type": "number", "description": "New amount or matching amount."},
                    "type": {"type": "string", "description": "New type: expense_var, expense_fixed, income (optional)."},
                    "date_operation": {"type": "string", "description": "New date of the transaction or matching date (YYYY-MM-DD)."}
                },
                "required": []
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "get_saving_recommendations",
            "description": "Analyze financial history of last 6 months to suggest a tailored saving rule (e.g. 50/30/20 rule adaptation).",
            "parameters": {"type": "object", "properties": {}}
        }
    },
    {
        "type": "function",
        "function": {
            "name": "search_similar_past_spends",
            "description": "Search database for similar seasonal expenditures from the previous year (e.g. comparing holiday, heating, or gift spends).",
            "parameters": {
                "type": "object",
                "properties": {
                    "keyword": {"type": "string", "description": "Description keyword to look for in past year transactions."}
                },
                "required": ["keyword"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "generate_csv_export_link",
            "description": "Create a temporary CSV file with filtered transactions matching user criteria, and return the download URL.",
            "parameters": {
                "type": "object",
                "properties": {
                    "category": {"type": "string", "description": "Optional category filter."},
                    "start_date": {"type": "string", "description": "Optional start date filter (YYYY-MM-DD)."},
                    "end_date": {"type": "string", "description": "Optional end date filter (YYYY-MM-DD)."},
                    "type": {"type": "string", "description": "Optional transaction type filter."}
                }
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "simulate_loan_amortization",
            "description": "Calculate loan monthly payments, total interest, and project its impact on the user's Reste à Vivre.",
            "parameters": {
                "type": "object",
                "properties": {
                    "principal": {"type": "number", "description": "The amount to borrow."},
                    "rate_percent": {"type": "number", "description": "Annual interest rate (e.g. 3.5)."},
                    "years": {"type": "integer", "description": "Duration of loan in years."}
                },
                "required": ["principal", "rate_percent", "years"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "create_budget_envelope",
            "description": "Create a new budget envelope with a specific limit, period (monthly, yearly, custom), and optional category names.",
            "parameters": {
                "type": "object",
                "properties": {
                    "name": {"type": "string", "description": "Name of the budget envelope."},
                    "monthly_amount": {"type": "number", "description": "Amount allocated to this budget (monthly value)."},
                    "period": {"type": "string", "description": "Period: monthly, yearly, custom, indefinite."},
                    "categories": {"type": "array", "items": {"type": "string"}, "description": "List of category names linked to this budget."},
                    "is_project": {"type": "boolean", "description": "True if this budget is a project (tracked via transactions budget_id)."}
                },
                "required": ["name", "monthly_amount"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "update_budget_envelope",
            "description": "Update details of an existing budget envelope. Identify by budget_id or by name.",
            "parameters": {
                "type": "object",
                "properties": {
                    "budget_id": {"type": "integer", "description": "The ID of the budget to update (if known, or identify by name)."},
                    "name": {"type": "string", "description": "Name of the budget envelope (used to identify or rename)."},
                    "monthly_amount": {"type": "number", "description": "New budget amount (optional)."},
                    "period": {"type": "string", "description": "New period (optional)."},
                    "categories": {"type": "array", "items": {"type": "string"}, "description": "New list of categories (optional)."},
                    "is_closed": {"type": "boolean", "description": "True to archive/close the budget."}
                },
                "required": []
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "delete_budget_envelope",
            "description": "Delete a budget envelope from the database. Identify by budget_id or by name.",
            "parameters": {
                "type": "object",
                "properties": {
                    "budget_id": {"type": "integer", "description": "The ID of the budget to delete."},
                    "name": {"type": "string", "description": "Name of the budget envelope to delete."}
                },
                "required": []
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "delete_transaction",
            "description": "Delete a specific transaction from the database (e.g. to resolve a duplicate entry). Identify by transaction_id or by description/amount/date.",
            "parameters": {
                "type": "object",
                "properties": {
                    "transaction_id": {"type": "integer", "description": "The ID of the transaction to delete (if known)."},
                    "description": {"type": "string", "description": "Description of the transaction to identify and delete (optional)."},
                    "amount": {"type": "number", "description": "Amount of the transaction to delete (optional)."},
                    "date_operation": {"type": "string", "description": "Date of the transaction (YYYY-MM-DD, optional)."}
                },
                "required": []
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "allocate_savings_funds",
            "description": "Add or withdraw funds from a savings envelope (tirelire). Positive amount to deposit, negative to withdraw.",
            "parameters": {
                "type": "object",
                "properties": {
                    "budget_id": {"type": "integer", "description": "The ID of the savings budget to allocate funds to/from."},
                    "amount": {"type": "number", "description": "Amount to allocate. Positive for deposit, negative for withdrawal."},
                    "note": {"type": "string", "description": "Optional comment or reason for this allocation."}
                },
                "required": ["budget_id", "amount"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "create_recurrence_template",
            "description": "Create a new recurring transaction template (bill, salary, regular transfer).",
            "parameters": {
                "type": "object",
                "properties": {
                    "amount": {"type": "number", "description": "Transaction amount (positive for income, negative for expense)."},
                    "description": {"type": "string", "description": "Description of the recurrence."},
                    "frequency": {"type": "string", "description": "Frequency: Weekly, Bi-weekly, Semi-monthly, Monthly, Quarterly, Semiannual, Yearly."},
                    "category": {"type": "string", "description": "Category name."},
                    "type": {"type": "string", "description": "Type: expense_fixed, expense_var, income, transfer, neutral."},
                    "day_of_month": {"type": "integer", "description": "Day of the month the transaction occurs (1-31)."},
                    "start_date": {"type": "string", "description": "Start date in YYYY-MM-DD format."}
                },
                "required": ["amount", "description", "frequency", "category", "type", "day_of_month"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "update_recurrence_template",
            "description": "Update details of an existing recurrence template.",
            "parameters": {
                "type": "object",
                "properties": {
                    "template_id": {"type": "integer", "description": "The ID of the template to update."},
                    "amount": {"type": "number", "description": "New amount (optional)."},
                    "description": {"type": "string", "description": "New description (optional)."},
                    "frequency": {"type": "string", "description": "New frequency (optional)."},
                    "category": {"type": "string", "description": "New category name (optional)."},
                    "type": {"type": "string", "description": "New type (optional)."},
                    "day_of_month": {"type": "integer", "description": "New day of month (optional)."},
                    "is_active": {"type": "boolean", "description": "True to activate, False to pause (optional)."}
                },
                "required": ["template_id"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "close_recurrence_template",
            "description": "Close a recurring transaction template to mark it as ended/inactive, stop future scheduled debit projections, and purge upcoming unreconciled instances while keeping historical transactions.",
            "parameters": {
                "type": "object",
                "properties": {
                    "template_id": {"type": "integer", "description": "The ID of the recurrence template to close."},
                    "description": {"type": "string", "description": "Description of the recurrence template if ID is not known."},
                    "closure_date": {"type": "string", "description": "Effective cutoff date (YYYY-MM-DD). Default is today."}
                },
                "required": ["template_id"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "delete_recurrence_template",
            "description": "Delete a recurrence template permanently.",
            "parameters": {
                "type": "object",
                "properties": {
                    "template_id": {"type": "integer", "description": "The ID of the template to delete."}
                },
                "required": ["template_id"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "create_category",
            "description": "Create a new transaction category.",
            "parameters": {
                "type": "object",
                "properties": {
                    "name": {"type": "string", "description": "Name of the new category."},
                    "type": {"type": "string", "description": "Category type: expense_var, expense_fixed, income, neutral."}
                },
                "required": ["name", "type"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "delete_category",
            "description": "Delete a category from the database.",
            "parameters": {
                "type": "object",
                "properties": {
                    "name": {"type": "string", "description": "Name of the category to delete."}
                },
                "required": ["name"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "set_predicted_paycheck",
            "description": "Set/override the predicted paycheck details (estimated amount, day of month, or custom date).",
            "parameters": {
                "type": "object",
                "properties": {
                    "amount": {"type": "number", "description": "Estimated paycheck amount."},
                    "day_of_month": {"type": "integer", "description": "Estimated day of month."},
                    "date_override": {"type": "string", "description": "Force a specific date for the next paycheck in YYYY-MM-DD format (optional)."}
                },
                "required": ["amount", "day_of_month"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "store_financial_fact",
            "description": "Store a persistent financial fact about the user (e.g., rent amount, financial goals, recurring events) to the memory database. Set private_to_session to true if the fact should only be remembered within this chat session, or false if it should be remembered globally across all conversations.",
            "parameters": {
                "type": "object",
                "properties": {
                    "key": {"type": "string", "description": "Unique technical key for the fact (e.g. 'monthly_rent_euros', 'savings_goal_euros')."},
                    "value": {"type": "string", "description": "The fact value (could be a number, short text, or JSON string)."},
                    "private_to_session": {"type": "boolean", "description": "If true, this fact is isolated to this conversation. If false, it is shared across all conversations. Default is false."}
                },
                "required": ["key", "value"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "forget_financial_fact",
            "description": "Delete a persistent financial fact about the user from the memory database. Key and private_to_session must match the parameters used when storing.",
            "parameters": {
                "type": "object",
                "properties": {
                    "key": {"type": "string", "description": "Technical key of the fact to delete."},
                    "private_to_session": {"type": "boolean", "description": "Must match the visibility setting used when storing. Default is false."}
                },
                "required": ["key"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "get_application_knowledge",
            "description": "Look up official OmniBank documentation, formulas, and operational rules (e.g. how Reste à Vivre is computed, Auto-Pilot states LINKED_COMING vs AUTO_COMMIT, budget envelopes EMA recalibration, What-If simulation cones, CSV/Woob bank sync, and Privacy mode).",
            "parameters": {
                "type": "object",
                "properties": {
                    "topic": {
                        "type": "string",
                        "description": "Topic or query to look up (e.g. 'reste_a_vivre', 'autopilot', 'budgets', 'simulateur', 'comptes_imports', 'confidentialite_modes', or a question)."
                    }
                }
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "create_planned_transfer",
            "description": "Register a planned internal transfer transaction between two accounts in OmniBank (e.g. from a liquid savings account like Livret A to the main checking account) to update projected balances and Reste à Vivre in the application. Note: The system automatically assigns the category 'Virement interne'. The actual banking wire transfer must be performed by the user on their bank's application or web portal.",
            "parameters": {
                "type": "object",
                "properties": {
                    "from_account": {"type": "string", "description": "Source account name or ID (e.g. 'Livret A')."},
                    "to_account": {"type": "string", "description": "Destination account name or ID (e.g. 'CA Centre-Est')."},
                    "amount": {"type": "number", "description": "Amount to transfer in euros."},
                    "description": {"type": "string", "description": "Contextual label for the transfer in OmniBank (e.g. 'Virement de précaution pour solde débiteur')."},
                    "date_operation": {"type": "string", "description": "Date of the transfer in YYYY-MM-DD format (defaults to today)."}
                },
                "required": ["from_account", "to_account", "amount"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "trigger_bank_sync",
            "description": "Trigger an online bank synchronization (relevé en ligne) in the background to fetch recent transactions from bank accounts and automatically match/reconcile them with planned operations via Auto-Pilot.",
            "parameters": {
                "type": "object",
                "properties": {},
                "required": []
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "store_financial_fact",
            "description": "Store a persistent financial fact, context, or temporary situation in long-term memory (e.g. temporary tax installment until December 2026, planned upcoming major expense, job change, debt repayment plan).",
            "parameters": {
                "type": "object",
                "properties": {
                    "key": {"type": "string", "description": "A short snake_case identifier for this fact (e.g. 'impots_ajustement_temporaire_2026')."},
                    "value": {"type": "string", "description": "The detailed factual statement to remember, including amounts and relevant dates/deadlines."}
                },
                "required": ["key", "value"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "forget_financial_fact",
            "description": "Remove or forget an obsolete financial fact from long-term memory.",
            "parameters": {
                "type": "object",
                "properties": {
                    "key": {"type": "string", "description": "The identifier of the fact to remove."}
                },
                "required": ["key"]
            }
        }
    }
]

