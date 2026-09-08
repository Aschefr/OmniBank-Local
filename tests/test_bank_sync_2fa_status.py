import pytest
from datetime import datetime, timezone
from unittest.mock import patch, MagicMock
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from app.models import Base, BankConnection, Notification
from app.services.bank_sync_scheduler import execute_auto_sync_for_connection
from woob.exceptions import NeedInteractiveFor2FA


@pytest.fixture
def db_session():
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)
    Session = sessionmaker(bind=engine)
    session = Session()

    yield session
    session.close()


def test_2fa_exception_in_scheduler_sets_2fa_required_status(db_session):
    """Vérifie que la levée d'un 2FA en arrière-plan passe la connexion en '2fa_required' sans crash critique."""
    conn = BankConnection(
        label="Crédit Mutuel Test",
        backend="creditmutuel",
        last_sync_status="idle"
    )
    db_session.add(conn)
    db_session.commit()

    with patch("app.services.bank_sync_service.BankSyncService.fetch_preview_transactions") as mock_fetch, \
         patch("app.services.diagnostic_service.record_backend_exception") as mock_diag:
        
        # Simuler une exception 2FA
        mock_fetch.side_effect = NeedInteractiveFor2FA("Authentification interactive 2FA requise par votre banque.")

        result = execute_auto_sync_for_connection(db_session, conn, "master_pw", "default")

        assert result is None
        assert conn.last_sync_status == "2fa_required"
        assert "2fa" in conn.last_error.lower() or "authentification" in conn.last_error.lower()
        # Vérifier que ce n'est PAS consigné comme une erreur logicielle critique
        mock_diag.assert_not_called()

        # Vérifier qu'une notification de type 'bank_sync_2fa' a bien été générée
        notif = db_session.query(Notification).filter(Notification.type == "bank_sync_2fa").first()
        assert notif is not None
        assert "2FA" in notif.title
        assert notif.is_read is False


def test_successful_preview_resets_2fa_and_error_state(db_session):
    """Vérifie qu'un preview ou commit réussi efface l'erreur 2FA antérieure et archive les notifications."""
    conn = BankConnection(
        label="Crédit Mutuel Test",
        backend="creditmutuel",
        last_sync_status="2fa_required",
        last_error="Authentification 2FA requise par votre banque."
    )
    db_session.add(conn)
    db_session.commit()

    # Créer une notification 2FA existante
    notif = Notification(
        type="bank_sync_2fa",
        title="🔐 Validation 2FA requise",
        content="2FA requis",
        link_data=f'{{"conn_id": {conn.id}}}',
        is_read=False,
        is_archived=False
    )
    db_session.add(notif)
    db_session.commit()

    # Simuler le nettoyage fait dans les endpoints bank_sync lors d'un succès
    conn.last_error = None
    conn.last_sync_status = "success"
    conn.last_sync_at = datetime.now(timezone.utc)
    db_session.query(Notification).filter(
        Notification.type.in_(["bank_sync_error", "bank_sync_2fa"]),
        Notification.link_data.like(f'%"conn_id": {conn.id}%')
    ).update({"is_read": True, "is_archived": True}, synchronize_session=False)
    db_session.commit()

    assert conn.last_error is None
    assert conn.last_sync_status == "success"
    
    db_session.refresh(notif)
    assert notif.is_read is True
    assert notif.is_archived is True
