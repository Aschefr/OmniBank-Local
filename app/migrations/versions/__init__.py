"""
Registre ordonné de toutes les versions de migration de schéma.
"""
from typing import List
from app.migrations.runner import Migration

from app.migrations.versions import (
    v02_technical_types,
    v03_savings_allocations,
    v04_salary_override,
    v05_transfer_reclassification,
    v06_chat_system,
    v07_skipped_transactions,
    v08_notifications_system,
    v09_notifications_detail,
    v10_notifications_link,
    v11_action_history,
    v12_chat_compression_v2,
    v13_chat_bubble_after,
    v14_chat_compression_stack,
    v15_allocations_account_link,
    v16_multi_currency,
    v17_cross_profile_links,
    v18_simulator_scenarios,
    v19_loan_rate_parameters,
    v20_smart_label_mappings,
    v21_smart_label_exclusions,
    v22_notification_archiving,
    v23_chat_entity_snapshots,
    v24_autopilot_foundations,
    v25_smart_label_reliability,
)

ALL_MIGRATIONS: List[Migration] = [
    Migration(v02_technical_types.VERSION, v02_technical_types.DESCRIPTION, v02_technical_types.upgrade),
    Migration(v03_savings_allocations.VERSION, v03_savings_allocations.DESCRIPTION, v03_savings_allocations.upgrade),
    Migration(v04_salary_override.VERSION, v04_salary_override.DESCRIPTION, v04_salary_override.upgrade),
    Migration(v05_transfer_reclassification.VERSION, v05_transfer_reclassification.DESCRIPTION, v05_transfer_reclassification.upgrade),
    Migration(v06_chat_system.VERSION, v06_chat_system.DESCRIPTION, v06_chat_system.upgrade),
    Migration(v07_skipped_transactions.VERSION, v07_skipped_transactions.DESCRIPTION, v07_skipped_transactions.upgrade),
    Migration(v08_notifications_system.VERSION, v08_notifications_system.DESCRIPTION, v08_notifications_system.upgrade),
    Migration(v09_notifications_detail.VERSION, v09_notifications_detail.DESCRIPTION, v09_notifications_detail.upgrade),
    Migration(v10_notifications_link.VERSION, v10_notifications_link.DESCRIPTION, v10_notifications_link.upgrade),
    Migration(v11_action_history.VERSION, v11_action_history.DESCRIPTION, v11_action_history.upgrade),
    Migration(v12_chat_compression_v2.VERSION, v12_chat_compression_v2.DESCRIPTION, v12_chat_compression_v2.upgrade),
    Migration(v13_chat_bubble_after.VERSION, v13_chat_bubble_after.DESCRIPTION, v13_chat_bubble_after.upgrade),
    Migration(v14_chat_compression_stack.VERSION, v14_chat_compression_stack.DESCRIPTION, v14_chat_compression_stack.upgrade),
    Migration(v15_allocations_account_link.VERSION, v15_allocations_account_link.DESCRIPTION, v15_allocations_account_link.upgrade),
    Migration(v16_multi_currency.VERSION, v16_multi_currency.DESCRIPTION, v16_multi_currency.upgrade),
    Migration(v17_cross_profile_links.VERSION, v17_cross_profile_links.DESCRIPTION, v17_cross_profile_links.upgrade),
    Migration(v18_simulator_scenarios.VERSION, v18_simulator_scenarios.DESCRIPTION, v18_simulator_scenarios.upgrade),
    Migration(v19_loan_rate_parameters.VERSION, v19_loan_rate_parameters.DESCRIPTION, v19_loan_rate_parameters.upgrade),
    Migration(v20_smart_label_mappings.VERSION, v20_smart_label_mappings.DESCRIPTION, v20_smart_label_mappings.upgrade),
    Migration(v21_smart_label_exclusions.VERSION, v21_smart_label_exclusions.DESCRIPTION, v21_smart_label_exclusions.upgrade),
    Migration(v22_notification_archiving.VERSION, v22_notification_archiving.DESCRIPTION, v22_notification_archiving.upgrade),
    Migration(v23_chat_entity_snapshots.VERSION, v23_chat_entity_snapshots.DESCRIPTION, v23_chat_entity_snapshots.upgrade),
    Migration(v24_autopilot_foundations.VERSION, v24_autopilot_foundations.DESCRIPTION, v24_autopilot_foundations.upgrade),
    Migration(v25_smart_label_reliability.VERSION, v25_smart_label_reliability.DESCRIPTION, v25_smart_label_reliability.upgrade),
]
